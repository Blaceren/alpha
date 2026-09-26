/**
 * AFD-5B2A — the aggregation engine over the registered acquisition cohort.
 *
 * SET-BASED AND BOUNDED. Every function issues a FIXED number of statements that
 * does not grow with the number of learners, buckets or dimension members. A
 * four-hundred-bucket series costs the same number of queries as a one-bucket
 * one, and no cohort is ever hydrated into JavaScript to be counted or sorted
 * there — the whole point of the median strategy below is that SQLite returns at
 * most two rows per group no matter how large the cohort is.
 *
 * NO DYNAMIC SQL FROM A REQUEST. Grouping columns come from closed unions in
 * this module; dates, ids and limits arrive as bound parameters through Prisma
 * tagged templates. `$queryRawUnsafe` and `Prisma.raw` appear nowhere.
 */
import { Prisma } from "@prisma/client";
import { exactRatio, renderMinorUnits } from "@/lib/analytics/decimal";
import type { AnalyticsFilters } from "@/lib/analytics/affiliate-sources";
import type { AnalyticsDb, BreakdownDimension } from "@/lib/analytics/affiliate-queries";
import {
  cohortIntegrityStream,
  cohortMemberStream,
  lagDurationMs,
  LAG_KEYS,
  type CohortScope,
  type LagKey,
} from "@/lib/analytics/cohort-sources";
import type { ResolvedCutoff } from "@/lib/analytics/cohort-time";
import type { ResolvedPeriod, TimeBucket } from "@/lib/analytics/periods";

/* Row shapes are NAMED, never written inline: the raw-SQL auditor refuses to
 * parse a type-argument list containing `;`, and an unclassifiable call site
 * fails the gate even when it is perfectly parameter-bound. */
type CountRow = { v: unknown };
type CohortCountRow = { learners: unknown; pocket: unknown; fd: unknown };
type BucketCountRow = CohortCountRow & { g: unknown };
type GroupedCountRow = BucketCountRow & { last: unknown };
type MedianRow = { g: unknown; n: unknown; s: unknown; c: unknown };
type NegativeRow = { g: unknown; v: unknown };
type AmountRow = {
  n: unknown;
  currencies: unknown;
  configured: unknown;
  cur: unknown;
  minor: unknown;
  noncanonical: unknown;
};
type GroupedAmountRow = AmountRow & { g: unknown };

/** SQLite COUNT and SUM come back as BigInt through the raw interface. */
function toCount(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return 0;
  throw new TypeError("unexpected count shape from the cohort query");
}

export function cohortScope(
  period: ResolvedPeriod,
  cutoff: ResolvedCutoff,
  filters: AnalyticsFilters,
): CohortScope {
  return {
    filters,
    startUtc: period.startUtc,
    endUtc: period.endUtc,
    cutoffUtc: cutoff.cutoffUtc,
  };
}

/* ------------------------------------------------------------------ counts */

export type CohortCounts = {
  readonly cohortLearners: number;
  readonly pocketRegisteredLearners: number;
  readonly firstDepositLearners: number;
};

export const ZERO_COHORT_COUNTS: CohortCounts = {
  cohortLearners: 0,
  pocketRegisteredLearners: 0,
  firstDepositLearners: 0,
};

/**
 * The three headline counts, in ONE query.
 *
 * Each learner contributes exactly one row to the stream, so `COUNT(*)` is the
 * cohort size and a `COUNT` of a nullable conversion column is the number of
 * learners who reached that stage. There is no `DISTINCT` because there is
 * nothing to de-duplicate: `AffiliateAttribution.userId` is UNIQUE and both
 * conversion joins are aggregated per user upstream.
 */
export async function loadCohortCounts(
  db: AnalyticsDb,
  scope: CohortScope,
): Promise<CohortCounts> {
  const rows = await db.$queryRaw<CohortCountRow[]>(Prisma.sql`
    SELECT
      COUNT(*)             AS "learners",
      COUNT(s."pocketAt")  AS "pocket",
      COUNT(s."fdAt")      AS "fd"
    FROM (${cohortMemberStream(scope)}) s
  `);

  const row = rows[0];
  return {
    cohortLearners: toCount(row?.learners),
    pocketRegisteredLearners: toCount(row?.pocket),
    firstDepositLearners: toCount(row?.fd),
  };
}

/* ------------------------------------------------------------------- rates */

export type CohortRates = {
  readonly pocketRegistrationRate: string | null;
  readonly firstDepositRate: string | null;
  readonly pocketToFirstDepositRate: string | null;
};

/**
 * The three cohort conversion rates, as exact decimal strings.
 *
 * UNLIKE AFD-5B1's PERIOD RATIOS, these ARE cohort conversion: numerator and
 * denominator describe the SAME learners, selected by the same acquisition
 * interval and observed to the same cutoff. That is what makes
 * `pocketRegistrationRate` answerable as "of the learners this affiliate
 * acquired in January, this share had registered with Pocket by the cutoff".
 *
 * It is still not a CAUSAL claim and not a forecast, and the response says so.
 *
 * NULL ON A ZERO DENOMINATOR, never 0: "this affiliate acquired nobody in
 * January" and "it acquired forty and none converted" are different facts, and
 * only one of them belongs on a chart as a 0%.
 */
export function computeCohortRates(counts: CohortCounts): CohortRates {
  return {
    pocketRegistrationRate: exactRatio(counts.pocketRegisteredLearners, counts.cohortLearners),
    firstDepositRate: exactRatio(counts.firstDepositLearners, counts.cohortLearners),
    pocketToFirstDepositRate: exactRatio(
      counts.firstDepositLearners,
      counts.pocketRegisteredLearners,
    ),
  };
}

/** Denominator documentation, published beside the numbers. */
export const COHORT_RATE_DENOMINATORS = {
  pocketRegistrationRate: "cohortLearners",
  firstDepositRate: "cohortLearners",
  pocketToFirstDepositRate: "pocketRegisteredLearners",
} as const;

/* ----------------------------------------------------------------- medians */

export type MedianLag = {
  /** Exact decimal seconds, or null when the population is empty. */
  readonly medianSeconds: string | null;
  readonly sampleSize: number;
  /**
   * Durations that ran backwards. Excluded from the median and reported, never
   * clamped to zero — a deposit before its own registration is a broken record,
   * and hiding it would publish a plausible median built on one.
   */
  readonly negativeDurationCount: number;
};

export const EMPTY_MEDIAN: MedianLag = {
  medianSeconds: null,
  sampleSize: 0,
  negativeDurationCount: 0,
};

export type CohortMedians = Record<LagKey, MedianLag>;

export const EMPTY_MEDIANS: CohortMedians = {
  selectedClickToAcademyRegistration: EMPTY_MEDIAN,
  academyRegistrationToPocketRegistration: EMPTY_MEDIAN,
  pocketRegistrationToFirstDeposit: EMPTY_MEDIAN,
  selectedClickToFirstDeposit: EMPTY_MEDIAN,
};

/**
 * The exact median of a group, from its two central values.
 *
 * `s` is the SUM of the one or two central values and `c` is how many there
 * were, so the median is exactly `s / c` with `c ∈ {1, 2}`:
 *
 *   odd  population — one central value,  c = 1, median = s
 *   even population — two central values, c = 2, median = s / 2
 *
 * Because the values are whole seconds, `s / 2` has AT MOST ONE fractional
 * digit, and it is always `.0` or `.5`. Rendering at scale 1 through the exact
 * decimal owner is therefore lossless — nothing is rounded, nothing is
 * truncated, and no IEEE-754 float ever holds the value. `1.5` is the string
 * `"1.5"`, not `1.4999999999999998`.
 *
 * THIS IS A MEDIAN, NOT A MEAN. The whole-population average is deliberately not
 * computed and not published: one learner who deposited a year late would drag a
 * mean far away from the typical experience the metric exists to describe.
 */
const MEDIAN_SCALE = 1;

function renderMedian(sumOfCentralValues: number, centralCount: number): string | null {
  if (centralCount === 0) return null;
  return exactRatio(sumOfCentralValues, centralCount, MEDIAN_SCALE);
}

/**
 * Durations, in WHOLE SECONDS, for one lag over one grouping.
 *
 * SECONDS, FLOORED FROM EXACT INTEGER MILLISECONDS. The stored instants are
 * millisecond-resolution integers, so the subtraction is exact; the division by
 * 1000 is a deliberate resolution choice, because sub-second precision on "how
 * long until this learner deposited" is noise an operator cannot act on. The
 * SIGN IS CHECKED BEFORE THE DIVISION, so a duration of −400 ms is caught as a
 * negative rather than becoming a harmless-looking 0.
 *
 * `NULL` durations — a learner who never reached the stage — are excluded by the
 * `IS NOT NULL` guard, which is what makes each median's population exactly the
 * one its contract names.
 */
function lagValues(scope: CohortScope, lag: LagKey, groupKey: Prisma.Sql): Prisma.Sql {
  const ms = lagDurationMs(lag);
  return Prisma.sql`
    SELECT ${groupKey} AS "g", (${ms}) / 1000 AS "v"
    FROM (${cohortMemberStream(scope)}) s
    WHERE (${ms}) IS NOT NULL AND (${ms}) >= 0
  `;
}

/**
 * One row per learner whose duration for this lag runs BACKWARDS.
 *
 * Projected as rows rather than counted here so the caller can group them. The
 * grouping expression is aliased into this subquery and grouped by the ALIAS:
 * grouping by the expression directly would emit `GROUP BY 0` for the
 * whole-cohort key, and SQLite reads a bare integer in `GROUP BY` as a
 * POSITIONAL column reference, so the statement would fail rather than group by
 * the constant.
 */
function negativeLagRows(scope: CohortScope, lag: LagKey, groupKey: Prisma.Sql): Prisma.Sql {
  const ms = lagDurationMs(lag);
  return Prisma.sql`
    SELECT ${groupKey} AS "g"
    FROM (${cohortMemberStream(scope)}) s
    WHERE (${ms}) IS NOT NULL AND (${ms}) < 0
  `;
}

/**
 * Every median, for every group, in a bounded number of queries.
 *
 * ONE QUERY PER LAG — not one per group. `ROW_NUMBER()` and `COUNT()` are
 * partitioned BY THE GROUP, so a four-hundred-bucket series and a hundred-row
 * breakdown each cost the same four statements as a single summary. The
 * alternative — a count query and a central-value query per group — would issue
 * eight hundred statements for one chart, which is the per-bucket query loop
 * this codebase does not allow.
 *
 * THE `rn IN ((n+1)/2, (n+2)/2)` PREDICATE selects the central value(s) using
 * SQLite's integer division:
 *
 *   n = 5 → (6)/2 = 3 and (7)/2 = 3 → row 3 only        → one central value
 *   n = 4 → (5)/2 = 2 and (6)/2 = 3 → rows 2 and 3      → two central values
 *   n = 1 → (2)/2 = 1 and (3)/2 = 1 → row 1 only        → the value itself
 *
 * At most two rows per group ever leave SQLite, so memory is bounded by the
 * number of groups and not by the size of the cohort.
 */
async function loadMediansFor(
  db: AnalyticsDb,
  scope: CohortScope,
  groupKey: Prisma.Sql,
): Promise<Map<string, CohortMedians>> {
  const result = new Map<string, CohortMedians>();

  const ensure = (key: string): Record<LagKey, MedianLag> => {
    const existing = result.get(key);
    if (existing) return existing as Record<LagKey, MedianLag>;
    const created = { ...EMPTY_MEDIANS } as Record<LagKey, MedianLag>;
    result.set(key, created as CohortMedians);
    return created;
  };

  await Promise.all(
    LAG_KEYS.map(async (lag) => {
      const [central, negative] = await Promise.all([
        db.$queryRaw<MedianRow[]>(Prisma.sql`
          WITH r AS (
            SELECT
              d."g" AS "g",
              d."v" AS "v",
              ROW_NUMBER() OVER (PARTITION BY d."g" ORDER BY d."v") AS "rn",
              COUNT(*)     OVER (PARTITION BY d."g")                AS "n"
            FROM (${lagValues(scope, lag, groupKey)}) d
          )
          SELECT r."g" AS "g", r."n" AS "n", SUM(r."v") AS "s", COUNT(*) AS "c"
          FROM r
          WHERE r."rn" IN ((r."n" + 1) / 2, (r."n" + 2) / 2)
          GROUP BY r."g", r."n"
        `),
        db.$queryRaw<NegativeRow[]>(Prisma.sql`
          SELECT d."g" AS "g", COUNT(*) AS "v"
          FROM (${negativeLagRows(scope, lag, groupKey)}) d
          GROUP BY d."g"
        `),
      ]);

      for (const row of central) {
        const slot = ensure(String(row.g === null ? "" : row.g));
        slot[lag] = {
          medianSeconds: renderMedian(toCount(row.s), toCount(row.c)),
          sampleSize: toCount(row.n),
          negativeDurationCount: slot[lag].negativeDurationCount,
        };
      }

      for (const row of negative) {
        const slot = ensure(String(row.g === null ? "" : row.g));
        slot[lag] = { ...slot[lag], negativeDurationCount: toCount(row.v) };
      }
    }),
  );

  return result;
}

/** The single-group key used when a report has no grouping at all. */
const WHOLE_COHORT = Prisma.sql`0`;

export async function loadCohortMedians(
  db: AnalyticsDb,
  scope: CohortScope,
): Promise<CohortMedians> {
  const grouped = await loadMediansFor(db, scope, WHOLE_COHORT);
  return grouped.get("0") ?? { ...EMPTY_MEDIANS };
}

/* -------------------------------------------------------------- timeseries */

/**
 * The earliest selected-click instant in scope.
 *
 * Used only to give an `all_time` series a left edge, which by definition it
 * does not have. DERIVED FROM DATA and never invented: when the filters admit no
 * cohort at all this is null and the series is honestly empty, rather than
 * starting at some arbitrary epoch and drawing hundreds of zero buckets.
 */
export async function earliestCohortClick(
  db: AnalyticsDb,
  scope: CohortScope,
): Promise<Date | null> {
  const rows = await db.$queryRaw<CountRow[]>(
    Prisma.sql`SELECT MIN(s."clickAt") AS "v" FROM (${cohortMemberStream(scope)}) s`,
  );
  const value = rows[0]?.v;
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(toCount(value));
}

export type CohortBucket = {
  readonly localLabel: string;
  readonly counts: CohortCounts;
  readonly medians: CohortMedians;
};

/**
 * Counts and medians for every acquisition bucket.
 *
 * THE BUCKET IS AN ACQUISITION INTERVAL, NOT AN EVENT INTERVAL. A learner is
 * placed by the instant of their SELECTED CLICK, so a January click whose
 * deposit lands in April is counted in the January bucket — which is exactly the
 * difference between this mode and AFD-5B1's.
 *
 * THE CUTOFF IS THE REPORT'S, SHARED BY EVERY BUCKET. Giving each bucket its own
 * cutoff would give early buckets a longer follow-up window and make the series
 * a comparison of two different things.
 *
 * The boundaries travel INTO SQLite as a parameterised `VALUES` list, so an
 * empty interior bucket comes back as a real zero row rather than being missing
 * and having to be reconstructed — a quiet week is a fact about the week.
 */
export async function loadCohortBuckets(
  db: AnalyticsDb,
  scope: CohortScope,
  buckets: readonly TimeBucket[],
): Promise<CohortBucket[]> {
  const result: CohortBucket[] = buckets.map((bucket) => ({
    localLabel: bucket.localLabel,
    counts: { ...ZERO_COHORT_COUNTS },
    medians: { ...EMPTY_MEDIANS },
  }));
  if (buckets.length === 0) return result;

  // The bucket a learner belongs to, resolved inside SQLite from the boundary
  // list. Deliberately the same join for the counts and for the medians, so a
  // learner can never be placed in one bucket by one metric and another by the
  // next. The boundaries are bound parameters, never interpolated text.
  const values = Prisma.join(
    buckets.map((bucket, index) => Prisma.sql`(${index}, ${bucket.startUtc}, ${bucket.endUtc})`),
    ",",
  );

  const [counts, medians] = await Promise.all([
    db.$queryRaw<BucketCountRow[]>(Prisma.sql`
      WITH b("idx", "bs", "be") AS (VALUES ${values})
      SELECT
        b."idx"              AS "g",
        COUNT(*)             AS "learners",
        COUNT(s."pocketAt")  AS "pocket",
        COUNT(s."fdAt")      AS "fd"
      FROM b
      JOIN (${cohortMemberStream(scope)}) s
        ON s."clickAt" >= b."bs" AND s."clickAt" < b."be"
      GROUP BY b."idx"
    `),
    loadBucketMedians(db, scope, values),
  ]);

  for (const row of counts) {
    const slot = result[toCount(row.g)];
    if (!slot) continue;
    result[toCount(row.g)] = {
      localLabel: slot.localLabel,
      counts: {
        cohortLearners: toCount(row.learners),
        pocketRegisteredLearners: toCount(row.pocket),
        firstDepositLearners: toCount(row.fd),
      },
      medians: slot.medians,
    };
  }

  for (const [key, value] of medians) {
    const index = Number(key);
    const slot = result[index];
    if (slot) result[index] = { ...slot, medians: value };
  }

  return result;
}

/**
 * Bucket medians, reusing the one median implementation.
 *
 * The stream is wrapped so `s` carries an `idx` column, and `idx` becomes the
 * partition key — the SAME window query that serves the summary and the
 * breakdowns, with a different `GROUP BY`. One implementation of "median" exists
 * in this file, and every caller goes through it.
 */
async function loadBucketMedians(
  db: AnalyticsDb,
  scope: CohortScope,
  values: Prisma.Sql,
): Promise<Map<string, CohortMedians>> {
  const result = new Map<string, CohortMedians>();

  const ensure = (key: string): Record<LagKey, MedianLag> => {
    const existing = result.get(key);
    if (existing) return existing as Record<LagKey, MedianLag>;
    const created = { ...EMPTY_MEDIANS } as Record<LagKey, MedianLag>;
    result.set(key, created as CohortMedians);
    return created;
  };

  await Promise.all(
    LAG_KEYS.map(async (lag) => {
      const ms = lagDurationMs(lag);
      const durations = Prisma.sql`
        b("idx", "bs", "be") AS (VALUES ${values}),
        d AS (
          SELECT b."idx" AS "g", (${ms}) / 1000 AS "v", (${ms}) AS "raw"
          FROM b
          JOIN (${cohortMemberStream(scope)}) s
            ON s."clickAt" >= b."bs" AND s."clickAt" < b."be"
        )
      `;

      const [central, negative] = await Promise.all([
        db.$queryRaw<MedianRow[]>(Prisma.sql`
          WITH ${durations},
          r AS (
            SELECT
              d."g" AS "g",
              d."v" AS "v",
              ROW_NUMBER() OVER (PARTITION BY d."g" ORDER BY d."v") AS "rn",
              COUNT(*)     OVER (PARTITION BY d."g")                AS "n"
            FROM d
            WHERE d."raw" IS NOT NULL AND d."raw" >= 0
          )
          SELECT r."g" AS "g", r."n" AS "n", SUM(r."v") AS "s", COUNT(*) AS "c"
          FROM r
          WHERE r."rn" IN ((r."n" + 1) / 2, (r."n" + 2) / 2)
          GROUP BY r."g", r."n"
        `),
        db.$queryRaw<NegativeRow[]>(Prisma.sql`
          WITH ${durations}
          SELECT d."g" AS "g", COUNT(*) AS "v"
          FROM d
          WHERE d."raw" IS NOT NULL AND d."raw" < 0
          GROUP BY d."g"
        `),
      ]);

      for (const row of central) {
        const slot = ensure(String(toCount(row.g)));
        slot[lag] = {
          medianSeconds: renderMedian(toCount(row.s), toCount(row.c)),
          sampleSize: toCount(row.n),
          negativeDurationCount: slot[lag].negativeDurationCount,
        };
      }
      for (const row of negative) {
        const slot = ensure(String(toCount(row.g)));
        slot[lag] = { ...slot[lag], negativeDurationCount: toCount(row.v) };
      }
    }),
  );

  return result;
}

/* --------------------------------------------------------------- breakdown */

/** Closed mapping from a request word to a stream column. Never interpolated. */
function dimensionColumn(dimension: BreakdownDimension): Prisma.Sql {
  switch (dimension) {
    case "affiliate":
      return Prisma.sql`s."pid"`;
    case "campaign":
      return Prisma.sql`s."cid"`;
    case "tracking_link":
      return Prisma.sql`s."lid"`;
  }
}

export type CohortBreakdownRow = {
  readonly dimensionId: number;
  readonly counts: CohortCounts;
  readonly medians: CohortMedians;
  readonly lastCohortActivityAt: Date | null;
};

/**
 * Counts, medians and last activity for every dimension member, in a bounded
 * number of queries.
 *
 * `lastCohortActivityAt` is the most recent AUTHORITATIVE COHORT EVENT observed
 * by the cutoff for this member's learners — the latest of the selected click,
 * the Academy registration, the Pocket registration and the first deposit. It is
 * never `now()`, never `updatedAt` and never an event after the cutoff, so a
 * historical report's "last activity" does not move when the report is re-run.
 *
 * Members whose dimension is null are excluded: a learner acquired through a
 * link with no campaign cannot be a row in a campaign breakdown. Nothing is
 * lost — the summary reports the whole cohort under the same filters.
 */
export async function loadCohortBreakdown(
  db: AnalyticsDb,
  scope: CohortScope,
  dimension: BreakdownDimension,
): Promise<Map<number, CohortBreakdownRow>> {
  const column = dimensionColumn(dimension);
  const rows = new Map<number, CohortBreakdownRow>();

  const [counts, medians] = await Promise.all([
    db.$queryRaw<GroupedCountRow[]>(Prisma.sql`
      SELECT
        ${column}            AS "g",
        COUNT(*)             AS "learners",
        COUNT(s."pocketAt")  AS "pocket",
        COUNT(s."fdAt")      AS "fd",
        MAX(MAX(
          s."clickAt",
          s."regAt",
          COALESCE(s."pocketAt", s."regAt"),
          COALESCE(s."fdAt",     s."regAt")
        ))                   AS "last"
      FROM (${cohortMemberStream(scope)}) s
      WHERE ${column} IS NOT NULL
      GROUP BY ${column}
    `),
    loadMediansFor(db, scope, column),
  ]);

  for (const row of counts) {
    const id = toCount(row.g);
    const raw = row.last;
    rows.set(id, {
      dimensionId: id,
      counts: {
        cohortLearners: toCount(row.learners),
        pocketRegisteredLearners: toCount(row.pocket),
        firstDepositLearners: toCount(row.fd),
      },
      medians: medians.get(String(id)) ?? { ...EMPTY_MEDIANS },
      lastCohortActivityAt:
        raw === null || raw === undefined
          ? null
          : raw instanceof Date
            ? raw
            : new Date(toCount(raw)),
    });
  }

  return rows;
}

/* ------------------------------------------------------------- integrity */

export type CohortIntegrity = {
  /**
   * Attributed learners in the interval with no authoritative Academy
   * registration event, or with more than one. Excluded from every metric.
   */
  readonly missingOrDuplicateRegistrationCount: number;
  /** Cohort learners carrying more than one confirmed first deposit. */
  readonly duplicateFirstDepositCount: number;
};

export async function loadCohortIntegrity(
  db: AnalyticsDb,
  scope: CohortScope,
): Promise<CohortIntegrity> {
  const [malformed, duplicateFd] = await Promise.all([
    db.$queryRaw<CountRow[]>(
      Prisma.sql`SELECT COUNT(*) AS "v" FROM (${cohortIntegrityStream(scope)}) s`,
    ),
    db.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(*) AS "v"
      FROM (${cohortMemberStream(scope)}) s
      WHERE s."fdCount" > 1
    `),
  ]);

  return {
    missingOrDuplicateRegistrationCount: toCount(malformed[0]?.v),
    duplicateFirstDepositCount: toCount(duplicateFd[0]?.v),
  };
}

/* --------------------------------------------------------------- FD money */

export type CohortAmountAvailability =
  | {
      readonly amountAggregationAvailable: true;
      readonly amountTotal: string;
      readonly currencyCode: string;
      readonly unavailableReason: null;
    }
  | {
      readonly amountAggregationAvailable: false;
      readonly amountTotal: null;
      readonly currencyCode: null;
      readonly unavailableReason: "currency_unspecified_or_mixed" | "no_confirmed_first_deposits";
    };

export const NO_COHORT_DEPOSITS: CohortAmountAvailability = {
  amountAggregationAvailable: false,
  amountTotal: null,
  currencyCode: null,
  unavailableReason: "no_confirmed_first_deposits",
};

/**
 * The cohort's confirmed first-deposit money, under AFD-5B1's exact contract.
 *
 * Summed BY SQLITE IN INTEGER MINOR UNITS, so no float touches the value on
 * either side of the wire. A total is published only when EVERY included row
 * carries the same non-null configured currency; if any row is unspecified, or a
 * second code appears, or a stored amount is not the canonical two-decimal form,
 * the total is withheld and the reason is named. There is no USD fallback and no
 * conversion — a wrong revenue number that looks right is worse than an explicit
 * absence, because only one of the two gets questioned.
 */
const COHORT_AMOUNT_AGGREGATE = Prisma.sql`
  COUNT(*)                                                        AS "n",
  COUNT(DISTINCT s."fdCur")                                       AS "currencies",
  SUM(CASE WHEN s."fdCurst" = 'configured' AND s."fdCur" IS NOT NULL
           THEN 1 ELSE 0 END)                                     AS "configured",
  MIN(s."fdCur")                                                  AS "cur",
  SUM(CAST(REPLACE(s."fdAmt", '.', '') AS INTEGER))               AS "minor",
  SUM(CASE WHEN s."fdAmt" GLOB '*.[0-9][0-9]'
            AND s."fdAmt" NOT GLOB '*.*.*'
            AND s."fdAmt" NOT GLOB '*[^0-9.]*'
           THEN 0 ELSE 1 END)                                     AS "noncanonical"
`;

function interpretAmounts(row: AmountRow | undefined): CohortAmountAvailability {
  const total = row === undefined ? 0 : toCount(row.n);
  if (total === 0) return NO_COHORT_DEPOSITS;

  const configured = toCount(row!.configured);
  const currencies = toCount(row!.currencies);
  const noncanonical = toCount(row!.noncanonical);
  const code = row!.cur;

  if (
    configured !== total ||
    currencies !== 1 ||
    noncanonical !== 0 ||
    typeof code !== "string" ||
    code.length === 0
  ) {
    return {
      amountAggregationAvailable: false,
      amountTotal: null,
      currencyCode: null,
      unavailableReason: "currency_unspecified_or_mixed",
    };
  }

  return {
    amountAggregationAvailable: true,
    amountTotal: renderMinorUnits(BigInt(toCount(row!.minor))),
    currencyCode: code,
    unavailableReason: null,
  };
}

export async function loadCohortAmount(
  db: AnalyticsDb,
  scope: CohortScope,
): Promise<CohortAmountAvailability> {
  const rows = await db.$queryRaw<AmountRow[]>(Prisma.sql`
    SELECT ${COHORT_AMOUNT_AGGREGATE}
    FROM (${cohortMemberStream(scope)}) s
    WHERE s."fdAt" IS NOT NULL
  `);
  return interpretAmounts(rows[0]);
}

/**
 * Every dimension member's money in ONE grouped query.
 *
 * The obvious implementation asks per row, which is the N+1 this codebase does
 * not allow: a hundred-row breakdown page would issue a hundred extra
 * statements.
 */
export async function loadCohortAmountByDimension(
  db: AnalyticsDb,
  scope: CohortScope,
  dimension: BreakdownDimension,
): Promise<Map<number, CohortAmountAvailability>> {
  const column = dimensionColumn(dimension);
  const rows = await db.$queryRaw<GroupedAmountRow[]>(Prisma.sql`
    SELECT ${column} AS "g", ${COHORT_AMOUNT_AGGREGATE}
    FROM (${cohortMemberStream(scope)}) s
    WHERE s."fdAt" IS NOT NULL AND ${column} IS NOT NULL
    GROUP BY ${column}
  `);

  const byId = new Map<number, CohortAmountAvailability>();
  for (const row of rows) byId.set(toCount(row.g), interpretAmounts(row));
  return byId;
}
