/**
 * AFD-5B1 — the aggregation engine over the metric event streams.
 *
 * SET-BASED, BOUNDED, PARAMETERISED. Every function here issues a fixed number
 * of queries that does NOT grow with the number of rows, buckets or dimension
 * members. There is no per-row lookup, no per-bucket query and no hydration of
 * event objects into JavaScript to be counted there: SQLite does the counting.
 *
 * NO DYNAMIC SQL FROM A REQUEST. Table names, column names, sort columns and
 * grouping columns are chosen from closed unions inside this module. Everything
 * a caller supplies — dates, ids, limits — arrives as a bound parameter through
 * a Prisma tagged template. `$queryRawUnsafe` and `Prisma.raw` appear nowhere.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { exactRatio, renderMinorUnits } from "@/lib/analytics/decimal";
import {
  buildEventStream,
  METRIC_KEYS,
  ZERO_COUNTS,
  type AnalyticsFilters,
  type Coverage,
  type MetricCounts,
  type MetricKey,
  type StreamScope,
} from "@/lib/analytics/affiliate-sources";
import type { ResolvedPeriod, TimeBucket } from "@/lib/analytics/periods";

/**
 * Anything that can run a parameterised raw query.
 *
 * Spelled as a union of the real client types rather than a `Pick`, matching
 * `XpDb` in curriculum/xp.ts. The raw-SQL auditor scans for the API name and a
 * `Pick` would put that name inside a STRING LITERAL, which reads to the scanner
 * as an unclassifiable call site.
 */
export type AnalyticsDb = PrismaClient | Prisma.TransactionClient;

/**
 * Row shapes for the raw queries below, named rather than written inline.
 *
 * The auditor refuses to parse a type-argument list containing `;`, so an inline
 * `{ a: unknown; b: unknown }` would make a perfectly parameter-bound call
 * unclassifiable. Naming them keeps every call site provably safe — and reads
 * better besides.
 */
type CountRow = { v: unknown };
type MinRow = { m: unknown };
type BucketRow = { idx: unknown; v: unknown };
type GroupedRow = { d: unknown; v: unknown; last: unknown };
type DimensionAmountRow = AmountAggregateRow & { d: unknown };

/** SQLite COUNT comes back as BigInt through the raw interface. */
function toCount(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return 0;
  throw new TypeError("unexpected count shape from the analytics query");
}

function scopeFor(
  period: ResolvedPeriod,
  filters: AnalyticsFilters,
  coverage: Coverage,
): StreamScope {
  return { coverage, filters, startUtc: period.startUtc, endUtc: period.endUtc };
}

/* ----------------------------------------------------------------- totals */

/**
 * All ten metrics for one coverage slice.
 *
 * Ten queries, one per metric, regardless of how much data exists. They are not
 * merged into a single statement on purpose: each reads a different table on a
 * different index, and a UNION would give up every one of those index scans.
 */
export async function loadCounts(
  db: AnalyticsDb,
  period: ResolvedPeriod,
  filters: AnalyticsFilters,
  coverage: Coverage,
): Promise<MetricCounts> {
  const scope = scopeFor(period, filters, coverage);
  const counts: MetricCounts = { ...ZERO_COUNTS };

  await Promise.all(
    METRIC_KEYS.map(async (metric) => {
      counts[metric] = await countMetric(db, metric, scope);
    }),
  );

  return counts;
}

async function countMetric(
  db: AnalyticsDb,
  metric: MetricKey,
  scope: StreamScope,
): Promise<number> {
  const stream = buildEventStream(metric, scope);
  const expression = stream.distinct
    ? Prisma.sql`COUNT(DISTINCT s."vid")`
    : Prisma.sql`COUNT(*)`;

  const rows = await db.$queryRaw<CountRow[]>(
    Prisma.sql`SELECT ${expression} AS "v" FROM (${stream.sql}) s`,
  );
  return toCount(rows[0]?.v);
}

/* ------------------------------------------------------------- timeseries */

export type BucketCounts = { readonly localLabel: string; readonly counts: MetricCounts };

/**
 * All ten metrics for every bucket, in ten queries total.
 *
 * The bucket boundaries travel INTO SQLite as a parameterised `VALUES` list and
 * are LEFT JOINed to the event stream, so an empty interior bucket comes back as
 * a real zero row rather than being absent and having to be reconstructed.
 * Ten queries for four hundred buckets is the whole reason for this shape; the
 * obvious implementation would have issued four thousand.
 */
export async function loadBucketCounts(
  db: AnalyticsDb,
  period: ResolvedPeriod,
  filters: AnalyticsFilters,
  coverage: Coverage,
  buckets: readonly TimeBucket[],
): Promise<BucketCounts[]> {
  const result: BucketCounts[] = buckets.map((bucket) => ({
    localLabel: bucket.localLabel,
    counts: { ...ZERO_COUNTS },
  }));
  if (buckets.length === 0) return result;

  const scope = scopeFor(period, filters, coverage);
  const values = Prisma.join(
    buckets.map((bucket, index) => Prisma.sql`(${index}, ${bucket.startUtc}, ${bucket.endUtc})`),
    ",",
  );

  await Promise.all(
    METRIC_KEYS.map(async (metric) => {
      const stream = buildEventStream(metric, scope);
      const expression = stream.distinct
        ? Prisma.sql`COUNT(DISTINCT s."vid")`
        : Prisma.sql`COUNT(s."t")`;

      const rows = await db.$queryRaw<BucketRow[]>(Prisma.sql`
        WITH b("idx", "s", "e") AS (VALUES ${values})
        SELECT b."idx" AS "idx", ${expression} AS "v"
        FROM b
        LEFT JOIN (${stream.sql}) s ON s."t" >= b."s" AND s."t" < b."e"
        GROUP BY b."idx"
        ORDER BY b."idx"
      `);

      for (const row of rows) {
        const index = toCount(row.idx);
        const slot = result[index];
        if (slot) slot.counts[metric] = toCount(row.v);
      }
    }),
  );

  return result;
}

/**
 * The earliest event instant in scope, across every source.
 *
 * Only used to give `all_time` a left edge for its series. It is DERIVED FROM
 * DATA and never invented: when no event exists the series is empty, which is
 * the honest rendering of "there is nothing to plot".
 */
export async function earliestEventInstant(
  db: AnalyticsDb,
  period: ResolvedPeriod,
  filters: AnalyticsFilters,
  coverage: Coverage,
): Promise<Date | null> {
  const scope = scopeFor(period, filters, coverage);

  const found = await Promise.all(
    METRIC_KEYS.filter((metric) => metric !== "uniqueVisitors").map(async (metric) => {
      const stream = buildEventStream(metric, scope);
      const rows = await db.$queryRaw<MinRow[]>(
        Prisma.sql`SELECT MIN(s."t") AS "m" FROM (${stream.sql}) s`,
      );
      const value = rows[0]?.m;
      if (value === null || value === undefined) return null;
      return value instanceof Date ? value : new Date(toCount(value));
    }),
  );

  const instants = found.filter((value): value is Date => value !== null);
  if (instants.length === 0) return null;
  return new Date(Math.min(...instants.map((value) => value.getTime())));
}

/* -------------------------------------------------------------- breakdown */

export type BreakdownDimension = "affiliate" | "campaign" | "tracking_link";

export type BreakdownRow = {
  readonly dimensionId: number;
  readonly counts: MetricCounts;
  readonly lastActivityAt: Date | null;
};

/** Closed mapping from a request word to a column. Never string-interpolated. */
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

/**
 * Every metric, grouped by one dimension, for the attributed slice.
 *
 * Rows whose dimension is null are excluded here: an event with no campaign
 * cannot be a row in a campaign breakdown. The unattributed total is reported
 * separately by the summary, so nothing is lost — it is just not pretended to be
 * a dimension member.
 */
export async function loadBreakdown(
  db: AnalyticsDb,
  period: ResolvedPeriod,
  filters: AnalyticsFilters,
  dimension: BreakdownDimension,
): Promise<Map<number, BreakdownRow>> {
  const scope = scopeFor(period, filters, "attributed");
  const column = dimensionColumn(dimension);
  const rows = new Map<number, BreakdownRow>();

  const ensure = (id: number): BreakdownRow => {
    const existing = rows.get(id);
    if (existing) return existing;
    const created: BreakdownRow = { dimensionId: id, counts: { ...ZERO_COUNTS }, lastActivityAt: null };
    rows.set(id, created);
    return created;
  };

  await Promise.all(
    METRIC_KEYS.map(async (metric) => {
      const stream = buildEventStream(metric, scope);
      const expression = stream.distinct
        ? Prisma.sql`COUNT(DISTINCT s."vid")`
        : Prisma.sql`COUNT(*)`;

      const grouped = await db.$queryRaw<GroupedRow[]>(
        Prisma.sql`
          SELECT ${column} AS "d", ${expression} AS "v", MAX(s."t") AS "last"
          FROM (${stream.sql}) s
          WHERE ${column} IS NOT NULL
          GROUP BY ${column}
        `,
      );

      for (const row of grouped) {
        const id = toCount(row.d);
        const target = ensure(id);
        target.counts[metric] = toCount(row.v);

        const raw = row.last;
        if (raw !== null && raw !== undefined) {
          const at = raw instanceof Date ? raw : new Date(toCount(raw));
          if (target.lastActivityAt === null || at.getTime() > target.lastActivityAt.getTime()) {
            rows.set(id, { ...target, lastActivityAt: at });
          }
        }
      }
    }),
  );

  return rows;
}

/* ----------------------------------------------------------- FD amounts */

export type AmountAvailability =
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

/**
 * The aggregate shape both amount queries share.
 *
 * `minor` is summed BY SQLITE IN INTEGER MINOR UNITS — `CAST(REPLACE(amt,'.',''))`
 * turns `"282.70"` into `28270` — so no floating point is involved on either
 * side of the wire. `noncanonical` counts any row whose stored text is not the
 * exact two-decimal form; a non-zero count withholds the total rather than
 * summing something whose scale is not what the cast assumed.
 */
const AMOUNT_AGGREGATE = Prisma.sql`
  COUNT(*)                                                        AS "n",
  COUNT(DISTINCT s."cur")                                         AS "currencies",
  SUM(CASE WHEN s."curst" = 'configured' AND s."cur" IS NOT NULL
           THEN 1 ELSE 0 END)                                     AS "configured",
  MIN(s."cur")                                                    AS "cur",
  SUM(CAST(REPLACE(s."amt", '.', '') AS INTEGER))                 AS "minor",
  SUM(CASE WHEN s."amt" GLOB '*.[0-9][0-9]'
            AND s."amt" NOT GLOB '*.*.*'
            AND s."amt" NOT GLOB '*[^0-9.]*'
           THEN 0 ELSE 1 END)                                     AS "noncanonical"
`;

type AmountAggregateRow = {
  n: unknown;
  currencies: unknown;
  configured: unknown;
  cur: unknown;
  minor: unknown;
  noncanonical: unknown;
};

/**
 * Decide availability from one aggregate row.
 *
 * THE COUNT IS ALWAYS AUTHORITATIVE; THE MONEY IS NOT. A total is published only
 * when every included row carries the SAME non-null configured currency. If any
 * row is `unspecified`, has a null code, or a second code appears, the total is
 * withheld and the reason is named.
 *
 * There is deliberately no fallback: unspecified amounts are not assumed to be
 * dollars, currencies are not converted, and a mixed set is not summed as if the
 * units matched. A wrong revenue number that looks right is worse than an
 * explicit absence, because only one of the two gets questioned.
 */
function interpretAmounts(row: AmountAggregateRow | undefined): AmountAvailability {
  const total = row === undefined ? 0 : toCount(row.n);
  if (total === 0) {
    return {
      amountAggregationAvailable: false,
      amountTotal: null,
      currencyCode: null,
      unavailableReason: "no_confirmed_first_deposits",
    };
  }

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

/** Confirmed first-deposit money for one scope, in a single grouped query. */
export async function loadAmountAvailability(
  db: AnalyticsDb,
  period: ResolvedPeriod,
  filters: AnalyticsFilters,
  coverage: Coverage,
): Promise<AmountAvailability> {
  const stream = buildEventStream("confirmedFirstDeposits", scopeFor(period, filters, coverage));
  const rows = await db.$queryRaw<AmountAggregateRow[]>(
    Prisma.sql`SELECT ${AMOUNT_AGGREGATE} FROM (${stream.sql}) s`,
  );
  return interpretAmounts(rows[0]);
}

/**
 * Confirmed first-deposit money for EVERY dimension member, in ONE query.
 *
 * The obvious implementation asks per row, which is the N+1 this codebase does
 * not allow: a hundred-row breakdown page would issue a hundred extra
 * statements. Grouping by the dimension answers all of them at once, and members
 * absent from the result simply have no deposits.
 */
export async function loadAmountAvailabilityByDimension(
  db: AnalyticsDb,
  period: ResolvedPeriod,
  filters: AnalyticsFilters,
  dimension: BreakdownDimension,
): Promise<Map<number, AmountAvailability>> {
  const stream = buildEventStream(
    "confirmedFirstDeposits",
    scopeFor(period, filters, "attributed"),
  );
  const column = dimensionColumn(dimension);

  const rows = await db.$queryRaw<DimensionAmountRow[]>(Prisma.sql`
    SELECT ${column} AS "d", ${AMOUNT_AGGREGATE}
    FROM (${stream.sql}) s
    WHERE ${column} IS NOT NULL
    GROUP BY ${column}
  `);

  const byId = new Map<number, AmountAvailability>();
  for (const row of rows) byId.set(toCount(row.d), interpretAmounts(row));
  return byId;
}

/** What a dimension member with no confirmed deposits reports. */
export const NO_DEPOSITS_AMOUNT: AmountAvailability = {
  amountAggregationAvailable: false,
  amountTotal: null,
  currencyCode: null,
  unavailableReason: "no_confirmed_first_deposits",
};

/* ---------------------------------------------------------------- ratios */

export type PeriodRatios = {
  readonly qualifiedClickToAcademyRegistrationRate: string | null;
  readonly academyRegistrationToPocketRegistrationRate: string | null;
  readonly pocketRegistrationToFirstDepositRate: string | null;
  readonly qualifiedClickToPocketRegistrationRate: string | null;
  readonly qualifiedClickToFirstDepositRate: string | null;
};

/**
 * The five funnel ratios, each an exact decimal string or null.
 *
 * THESE ARE PERIOD EVENT RATIOS, NOT COHORT CONVERSION. Numerator and
 * denominator are events that OCCURRED in the selected period and generally
 * belong to different acquisition cohorts: the registrations counted this week
 * were largely produced by clicks from previous weeks. The value is a useful
 * period health indicator and is not a probability that a click converts.
 * Acquisition-cohort conversion is AFD-5B2's job.
 */
export function computeRatios(counts: MetricCounts): PeriodRatios {
  return {
    qualifiedClickToAcademyRegistrationRate: exactRatio(
      counts.academyRegistrations,
      counts.qualifiedClicks,
    ),
    academyRegistrationToPocketRegistrationRate: exactRatio(
      counts.pocketRegistrations,
      counts.academyRegistrations,
    ),
    pocketRegistrationToFirstDepositRate: exactRatio(
      counts.confirmedFirstDeposits,
      counts.pocketRegistrations,
    ),
    qualifiedClickToPocketRegistrationRate: exactRatio(
      counts.pocketRegistrations,
      counts.qualifiedClicks,
    ),
    qualifiedClickToFirstDepositRate: exactRatio(
      counts.confirmedFirstDeposits,
      counts.qualifiedClicks,
    ),
  };
}

/** Denominator documentation, published alongside the numbers. */
export const RATIO_DENOMINATORS = {
  qualifiedClickToAcademyRegistrationRate: "qualifiedClicks",
  academyRegistrationToPocketRegistrationRate: "academyRegistrations",
  pocketRegistrationToFirstDepositRate: "pocketRegistrations",
  qualifiedClickToPocketRegistrationRate: "qualifiedClicks",
  qualifiedClickToFirstDepositRate: "qualifiedClicks",
} as const;
