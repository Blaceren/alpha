/**
 * G4-GROWTH — the Growth analytics query layer.
 *
 * ONE SHAPE FOR EVERY METRIC: count rows of one owner, in one half-open
 * `[start, end)` interval, filtered by one acquisition dimension. There is no
 * query here that joins two event types to infer a third fact, because a funnel
 * built by inference cannot be checked against its own sources.
 *
 * NO CALLER-SUPPLIED SQL, EVER. Dimensions and filters are enum members that
 * index a compile-time map. There is no path from a query string to a column
 * name, a table name, an ORDER BY or a raw fragment — every value below reaches
 * Prisma as a bound parameter.
 *
 * THE ACQUISITION JOIN, STATED ONCE. A growth event carries
 * `acquisitionClickId`, copied from the learner's FROZEN attribution at the time
 * the event was recorded. So "registrations from campaign X" means "registrations
 * by learners whose frozen acquisition click belongs to campaign X" — not "…who
 * most recently clicked X". That distinction is the whole reason attribution is
 * frozen at registration, and the API states the model in every response.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  GROWTH_METRIC_KEYS,
  LEDGER_METRIC_EVENT_TYPES,
  ZERO_GROWTH_COUNTS,
  type GrowthCoverageScope,
  type GrowthMetricCounts,
} from "@/lib/growth/analytics/sources";

export type GrowthPeriod = { readonly start: Date; readonly end: Date };

/**
 * The acquisition dimensions a Growth query may be sliced by.
 *
 * EVERY ONE OF THESE IS REALLY CAPTURED. §33 forbids offering a dimension the
 * platform does not actually collect, so there is no `creative`, no `angle` and
 * no `landingVariant` here — the tracking-link model has no such columns, and
 * exposing them as always-`Unknown` filters would imply a capability that does
 * not exist. They are recorded as a known gap instead.
 */
export const GROWTH_DIMENSIONS = [
  "affiliatePartner",
  "affiliateCampaign",
  "trackingLink",
  "sub1",
  "sub2",
  "sub3",
  "sub4",
  "sub5",
  "referrerHost",
] as const;

export type GrowthDimension = (typeof GROWTH_DIMENSIONS)[number];

export type GrowthFilters = {
  readonly affiliatePartnerId?: number;
  readonly affiliateCampaignId?: number;
  readonly trackingLinkId?: number;
};

/**
 * The click-side predicate for a set of filters.
 *
 * Reused by BOTH the click query and the ledger queries, so "clicks from
 * campaign X" and "registrations from campaign X" can never disagree about what
 * campaign X means.
 */
function clickWhere(filters: GrowthFilters): Prisma.AffiliateClickWhereInput {
  const link: Prisma.AffiliateTrackingLinkWhereInput = {};

  if (filters.affiliatePartnerId !== undefined) {
    link.affiliatePartnerId = filters.affiliatePartnerId;
  }
  if (filters.affiliateCampaignId !== undefined) {
    link.affiliateCampaignId = filters.affiliateCampaignId;
  }

  const where: Prisma.AffiliateClickWhereInput = {};

  if (filters.trackingLinkId !== undefined) where.trackingLinkId = filters.trackingLinkId;
  if (Object.keys(link).length > 0) where.trackingLink = link;

  return where;
}

/**
 * G4-H3/H4 — the coverage vocabulary, defined once in `sources.ts`.
 *
 * `unattributed` was renamed to `organic` so the API, the query layer, the metric
 * registry and the CRM all use one word for one population. The semantics are
 * unchanged: `acquisitionClickId IS NULL`.
 */
export type CoverageScope = GrowthCoverageScope;

/**
 * Turn filters plus a coverage scope into the ledger-side acquisition predicate.
 *
 * `organic` is `acquisitionClickId IS NULL`, and it is a FIRST-CLASS category
 * rather than a residual. A learner who arrived organically is a real learner,
 * and a funnel that silently omitted them would report a registration total
 * smaller than the platform's own user count with no visible reason.
 */
function ledgerAcquisitionWhere(
  filters: GrowthFilters,
  scope: CoverageScope,
): Prisma.GrowthEventWhereInput {
  if (scope === "organic") return { acquisitionClickId: null };

  const click = clickWhere(filters);
  const filtered = Object.keys(click).length > 0;

  if (scope === "attributed") {
    return filtered
      ? { acquisitionClick: click }
      : { acquisitionClickId: { not: null } };
  }

  // `total` with filters cannot include organic rows: events belonging to nobody
  // cannot belong to the campaign that was asked about. Returning them anyway
  // would answer a question the caller did not pose.
  return filtered ? { acquisitionClick: click } : {};
}

/** Count qualified clicks in the period. The accepted AFD-5B1 owner. */
export async function countClicks(
  db: Pick<PrismaClient, "affiliateClick">,
  period: GrowthPeriod,
  filters: GrowthFilters,
  scope: CoverageScope,
): Promise<number> {
  // An organic slice has no clicks BY CONSTRUCTION: a click is the thing that
  // creates attribution, so "clicks with no acquisition click" is not a small
  // number, it is a category error. Zero here is exact, not a placeholder.
  if (scope === "organic") return 0;

  return db.affiliateClick.count({
    where: {
      ...clickWhere(filters),
      classification: "qualified",
      occurredAt: { gte: period.start, lt: period.end },
    },
  });
}

/** Count one ledger event family in the period. */
export async function countLedgerEvents(
  db: Pick<PrismaClient, "growthEvent">,
  period: GrowthPeriod,
  filters: GrowthFilters,
  scope: CoverageScope,
  eventType: string,
  extra?: Prisma.GrowthEventWhereInput,
): Promise<number> {
  return db.growthEvent.count({
    where: {
      eventType: eventType as Prisma.GrowthEventWhereInput["eventType"],
      occurredAt: { gte: period.start, lt: period.end },
      ...ledgerAcquisitionWhere(filters, scope),
      ...(extra ?? {}),
    },
  });
}

/**
 * Redeposits whose identity could not be resolved.
 *
 * COUNTED FROM THE INGRESS TABLE, NOT THE LEDGER, and reported SEPARATELY from
 * every monetary metric. These are deliveries ATA received and deliberately did
 * not turn into money, because Pocket supplies no event identifier. Folding them
 * into a redeposit count would be inventing the very distinction the platform
 * refuses to claim.
 */
export async function countUnresolvedRedeposits(
  db: Pick<PrismaClient, "providerIngressEvent">,
  period: GrowthPeriod,
): Promise<number> {
  return db.providerIngressEvent.count({
    where: {
      goal: "redep",
      processingStatus: "identity_unresolved",
      receivedAt: { gte: period.start, lt: period.end },
    },
  });
}

/**
 * Assessments that PASSED.
 *
 * Read from the metadata flag the emitter writes, which is the verdict the
 * assessment owner reached. Deliberately not recomputed from a score here: a
 * second implementation of "did this pass" is a second answer waiting to
 * disagree with the first.
 */
async function countAssessmentsPassed(
  db: Pick<PrismaClient, "growthEvent">,
  period: GrowthPeriod,
  filters: GrowthFilters,
  scope: CoverageScope,
): Promise<number> {
  const rows = await db.growthEvent.findMany({
    where: {
      eventType: "assessment_completed",
      occurredAt: { gte: period.start, lt: period.end },
      ...ledgerAcquisitionWhere(filters, scope),
    },
    select: { metadata: true },
  });

  return rows.filter((row) => {
    const metadata = row.metadata as { passed?: unknown } | null;
    return metadata?.passed === true || metadata?.passed === 1;
  }).length;
}

/** Every headline count for one period, one filter set and one coverage scope. */
export async function loadGrowthCounts(
  db: PrismaClient,
  period: GrowthPeriod,
  filters: GrowthFilters,
  scope: CoverageScope,
): Promise<GrowthMetricCounts> {
  const ledgerKeys = Object.keys(LEDGER_METRIC_EVENT_TYPES) as Array<
    keyof typeof LEDGER_METRIC_EVENT_TYPES
  >;

  const [clicks, unresolvedRedeposits, assessmentsPassed, ...ledgerCounts] = await Promise.all([
    countClicks(db, period, filters, scope),
    countUnresolvedRedeposits(db, period),
    countAssessmentsPassed(db, period, filters, scope),
    ...ledgerKeys.map((key) =>
      countLedgerEvents(db, period, filters, scope, LEDGER_METRIC_EVENT_TYPES[key]),
    ),
  ]);

  const counts: GrowthMetricCounts = { ...ZERO_GROWTH_COUNTS, clicks, unresolvedRedeposits, assessmentsPassed };

  ledgerKeys.forEach((key, index) => {
    counts[key] = ledgerCounts[index];
  });

  return counts;
}

export type LevelFunnelStep = {
  readonly levelNumber: number;
  /** Distinct enrollment+level pairs with a real source-owned START in the period. */
  readonly startedLearners: number;
  /** Distinct enrollment+level pairs with a durable COMPLETION in the period. */
  readonly completedLearners: number;
  /**
   * The subset of `startedLearners` that went on to complete, ever. A subset, so
   * `startedAndCompletedLearners <= startedLearners` always holds.
   */
  readonly startedAndCompletedLearners: number;
  /**
   * Completions in the period whose progress row has NO start event at all —
   * the financial-checkpoint family, which cannot be started. Published so the
   * difference between the two completion figures is visible rather than
   * mysterious, never folded into a rate.
   */
  readonly completedWithoutStartLearners: number;
};

/**
 * G4-H1 — the per-level funnel, on a UNIQUE-ENTITY basis with a subset rate.
 *
 * WHAT WAS WRONG. The audited version published
 * `completionRate = level_completed events / level_started events`. Those are two
 * different populations: `runStartTransaction` REFUSES to start a financial
 * checkpoint, while checkpoint verification and staging attestation both complete
 * one. So a level could report more completions than starts, and the audit
 * measured it — L1 started=4, completed=5, `completionRate: "1.250000"`, a 125%
 * completion rate, with the per-step drop-off going negative.
 *
 * WHAT IS PUBLISHED NOW. Four counts on an explicit unique-entity basis, and one
 * rate that is a genuine subset fraction:
 *
 *   startedLearners              distinct progress rows started in the period
 *   completedLearners            distinct progress rows completed in the period
 *   startedAndCompletedLearners  of those STARTED in the period, how many ever
 *                                completed — a subset of `startedLearners`
 *   completedWithoutStartLearners completions whose progress row has no start
 *
 *   startedCompletionRate = startedAndCompletedLearners / startedLearners
 *
 * Because the numerator is drawn from the denominator's own set, the rate cannot
 * exceed 1 by construction rather than by clamping. `completedLearners` is still
 * published — "how many levels were finished this period" is a real question —
 * but it is never a numerator over starts.
 *
 * THE UNIQUE KEY IS THE PROGRESS ROW. Both families key on `progress:<id>`, and
 * `UserLevelProgress` is already unique per (enrollment, level), so counting
 * distinct `sourceEventId` counts distinct enrollment+level pairs exactly.
 *
 * ONE STATEMENT, NOT ONE PER LEVEL. `Prisma.sql` composition, fully
 * parameterised: every value below is a bound parameter and no identifier,
 * column, table or ORDER BY comes from a caller. `scope` and `filters` are
 * already-validated enum members and integers by the time they arrive.
 */
export async function loadLevelFunnel(
  db: Pick<PrismaClient, "$queryRaw">,
  period: GrowthPeriod,
  filters: GrowthFilters,
  scope: CoverageScope,
  maxLevel: number,
): Promise<LevelFunnelStep[]> {
  const acquisition = levelFunnelAcquisitionSql(filters, scope);

  const rows = await db.$queryRaw<
    Array<{
      levelNumber: number;
      startedLearners: number | bigint;
      completedLearners: number | bigint;
      startedAndCompletedLearners: number | bigint;
      completedWithoutStartLearners: number | bigint;
    }>
  >(Prisma.sql`
    SELECT
      g."levelNumber" AS "levelNumber",
      COUNT(DISTINCT CASE WHEN g."eventType" = 'level_started'
                          THEN g."sourceEventId" END) AS "startedLearners",
      COUNT(DISTINCT CASE WHEN g."eventType" = 'level_completed'
                          THEN g."sourceEventId" END) AS "completedLearners",
      COUNT(DISTINCT CASE WHEN g."eventType" = 'level_started' AND EXISTS (
                            SELECT 1 FROM "GrowthEvent" c
                            WHERE c."eventType" = 'level_completed'
                              AND c."sourceOwner" = g."sourceOwner"
                              AND c."sourceEventId" = g."sourceEventId")
                          THEN g."sourceEventId" END) AS "startedAndCompletedLearners",
      COUNT(DISTINCT CASE WHEN g."eventType" = 'level_completed' AND NOT EXISTS (
                            SELECT 1 FROM "GrowthEvent" s
                            WHERE s."eventType" = 'level_started'
                              AND s."sourceOwner" = g."sourceOwner"
                              AND s."sourceEventId" = g."sourceEventId")
                          THEN g."sourceEventId" END) AS "completedWithoutStartLearners"
    FROM "GrowthEvent" g
    WHERE g."eventType" IN ('level_started', 'level_completed')
      AND g."occurredAt" >= ${period.start}
      AND g."occurredAt" < ${period.end}
      AND g."levelNumber" IS NOT NULL
      AND g."levelNumber" <= ${maxLevel}
      ${acquisition}
    GROUP BY g."levelNumber"
    ORDER BY g."levelNumber" ASC
  `);

  return rows.map((row) => ({
    levelNumber: Number(row.levelNumber),
    startedLearners: Number(row.startedLearners),
    completedLearners: Number(row.completedLearners),
    startedAndCompletedLearners: Number(row.startedAndCompletedLearners),
    completedWithoutStartLearners: Number(row.completedWithoutStartLearners),
  }));
}

/**
 * The acquisition predicate for the level funnel, as a composable SQL fragment.
 *
 * Mirrors `ledgerAcquisitionWhere` exactly, so the funnel and every counted
 * metric agree about what a scope and a campaign mean. Filter ids are bound
 * parameters — `parseGrowthFilters` has already refused anything that is not a
 * positive safe integer, and `assertGrowthFilterHierarchy` has already proved
 * each one exists.
 */
function levelFunnelAcquisitionSql(
  filters: GrowthFilters,
  scope: CoverageScope,
): Prisma.Sql {
  if (scope === "organic") return Prisma.sql` AND g."acquisitionClickId" IS NULL`;

  const conditions: Prisma.Sql[] = [];
  if (filters.trackingLinkId !== undefined) {
    conditions.push(Prisma.sql`c."trackingLinkId" = ${filters.trackingLinkId}`);
  }
  if (filters.affiliatePartnerId !== undefined) {
    conditions.push(Prisma.sql`l."affiliatePartnerId" = ${filters.affiliatePartnerId}`);
  }
  if (filters.affiliateCampaignId !== undefined) {
    conditions.push(Prisma.sql`l."affiliateCampaignId" = ${filters.affiliateCampaignId}`);
  }

  if (conditions.length === 0) {
    // Unfiltered: `attributed` needs a click, `total` accepts everything.
    return scope === "attributed"
      ? Prisma.sql` AND g."acquisitionClickId" IS NOT NULL`
      : Prisma.empty;
  }

  return Prisma.sql` AND g."acquisitionClickId" IN (
    SELECT c."id" FROM "AffiliateClick" c
    JOIN "AffiliateTrackingLink" l ON l."id" = c."trackingLinkId"
    WHERE ${Prisma.join(conditions, " AND ")}
  )`;
}

export type LearnerFunnel = {
  /** Distinct learners with a canonical `ata_reg` in the period. */
  readonly registeredLearners: number;
  /** Of those, how many also enrolled / activated / registered with Pocket / deposited. */
  readonly enrolledLearners: number;
  readonly activatedLearners: number;
  readonly pocketRegisteredLearners: number;
  readonly depositedLearners: number;
  /** Distinct learners with a `pocket_reg`, and of those how many deposited. */
  readonly pocketRegisteredTotal: number;
  readonly depositedAmongPocketRegistered: number;
};

/**
 * G4-H3 — the acquisition funnel on a UNIQUE-LEARNER, SUBSET basis.
 *
 * WHY THIS EXISTS, AND WHY EVENT COUNTS ARE NOT ENOUGH. The audited candidate
 * computed `activationRate = academy_activation events / ata_reg events`. Two
 * different populations: an activation belongs to an enrollment, a registration
 * to a user, and the two sets are not nested. That was tolerable while `ata_reg`
 * covered every `User` row — and it stopped being tolerable the moment G4-H2
 * narrowed `ata_reg` to PROVEN self-service registrations, because enrollments
 * and activations still exist for learners whose registration origin this
 * database cannot prove. The first rehearsal against real PREPROD data reported
 * `activationRate = 1.250000` and `enrollmentRate = 1.583333` — 125% and 158%.
 *
 * So every downstream rate is now a SUBSET FRACTION of a learner population it is
 * actually drawn from: of the learners who registered in this period, how many
 * also enrolled, activated, registered with Pocket, deposited. Numerator ⊆
 * denominator by construction, so the rate cannot exceed 1 — the same guarantee
 * `startedCompletionRate` gets, for the same reason.
 *
 * The event COUNTS are still published separately and unchanged: "19 enrollments
 * happened" is a true and useful statement even when only 12 of those learners
 * have a provable registration. What is no longer published is a ratio between
 * the two.
 *
 * One statement, fully parameterised, no caller-supplied identifier.
 */
export async function loadLearnerFunnel(
  db: Pick<PrismaClient, "$queryRaw">,
  period: GrowthPeriod,
  filters: GrowthFilters,
  scope: CoverageScope,
): Promise<LearnerFunnel> {
  const acquisition = levelFunnelAcquisitionSql(filters, scope);

  const rows = await db.$queryRaw<
    Array<Record<string, number | bigint | null>>
  >(Prisma.sql`
    WITH scoped AS (
      SELECT g."userId" AS uid, g."eventType" AS et
      FROM "GrowthEvent" g
      WHERE g."userId" IS NOT NULL
        AND g."occurredAt" >= ${period.start}
        AND g."occurredAt" < ${period.end}
        ${acquisition}
    ),
    registered AS (SELECT DISTINCT uid FROM scoped WHERE et = 'ata_reg'),
    pocket AS (SELECT DISTINCT uid FROM scoped WHERE et = 'pocket_reg')
    SELECT
      (SELECT COUNT(*) FROM registered) AS "registeredLearners",
      (SELECT COUNT(DISTINCT s.uid) FROM scoped s
        WHERE s.et = 'curriculum_enrollment' AND s.uid IN (SELECT uid FROM registered)) AS "enrolledLearners",
      (SELECT COUNT(DISTINCT s.uid) FROM scoped s
        WHERE s.et = 'academy_activation' AND s.uid IN (SELECT uid FROM registered)) AS "activatedLearners",
      (SELECT COUNT(DISTINCT s.uid) FROM scoped s
        WHERE s.et = 'pocket_reg' AND s.uid IN (SELECT uid FROM registered)) AS "pocketRegisteredLearners",
      (SELECT COUNT(DISTINCT s.uid) FROM scoped s
        WHERE s.et = 'dep' AND s.uid IN (SELECT uid FROM registered)) AS "depositedLearners",
      (SELECT COUNT(*) FROM pocket) AS "pocketRegisteredTotal",
      (SELECT COUNT(DISTINCT s.uid) FROM scoped s
        WHERE s.et = 'dep' AND s.uid IN (SELECT uid FROM pocket)) AS "depositedAmongPocketRegistered"
  `);

  const row = rows[0] ?? {};
  const n = (key: string) => Number(row[key] ?? 0);

  return {
    registeredLearners: n("registeredLearners"),
    enrolledLearners: n("enrolledLearners"),
    activatedLearners: n("activatedLearners"),
    pocketRegisteredLearners: n("pocketRegisteredLearners"),
    depositedLearners: n("depositedLearners"),
    pocketRegisteredTotal: n("pocketRegisteredTotal"),
    depositedAmongPocketRegistered: n("depositedAmongPocketRegistered"),
  };
}

export type DepositAmountSummary = {
  readonly count: number;
  /** Canonical decimal TEXT, or null when no aggregation is possible. */
  readonly sum: string | null;
  readonly average: string | null;
  readonly median: string | null;
  readonly amountAggregationAvailable: boolean;
  readonly unavailableReason: string | null;
  readonly currencyCode: string | null;
};

/**
 * First-deposit amounts, aggregated ONLY when the unit is unambiguous.
 *
 * THE RULE: amounts are summed only when every row in the slice shares one
 * CONFIGURED currency. A slice mixing currencies, or containing any row whose
 * currency is `unspecified`, reports `amountAggregationAvailable: false` with a
 * reason — never a number. Adding 25 unknown units to 30 other unknown units
 * produces 55 of nothing, and a dashboard showing "55" would be inventing a
 * fact the provider never supplied.
 *
 * DECIMAL ARITHMETIC IN INTEGER MINOR UNITS. The stored form is canonical text
 * with exactly two fractional digits, so it converts to an exact integer number
 * of minor units, sums exactly, and converts back. No float ever touches money
 * on this path.
 */
export async function loadFirstDepositAmounts(
  db: Pick<PrismaClient, "growthEvent">,
  period: GrowthPeriod,
  filters: GrowthFilters,
  scope: CoverageScope,
): Promise<DepositAmountSummary> {
  const rows = await db.growthEvent.findMany({
    where: {
      eventType: "dep",
      occurredAt: { gte: period.start, lt: period.end },
      ...ledgerAcquisitionWhere(filters, scope),
    },
    select: { amount: true, currencyCode: true, currencyStatus: true },
  });

  if (rows.length === 0) {
    return {
      count: 0,
      sum: null,
      average: null,
      median: null,
      amountAggregationAvailable: false,
      unavailableReason: "no_deposits_in_period",
      currencyCode: null,
    };
  }

  const currencies = new Set(
    rows.map((row) => (row.currencyStatus === "configured" ? row.currencyCode : null)),
  );

  if (currencies.has(null)) {
    return {
      count: rows.length,
      sum: null,
      average: null,
      median: null,
      amountAggregationAvailable: false,
      unavailableReason: "currency_unspecified",
      currencyCode: null,
    };
  }
  if (currencies.size > 1) {
    return {
      count: rows.length,
      sum: null,
      average: null,
      median: null,
      amountAggregationAvailable: false,
      unavailableReason: "currency_mixed",
      currencyCode: null,
    };
  }

  const minorUnits = rows
    .map((row) => toMinorUnits(row.amount))
    .filter((value): value is bigint => value !== null);

  // A row whose stored amount could not be read is a corruption, not a zero.
  // Reporting a smaller total as if it were complete would hide it.
  if (minorUnits.length !== rows.length) {
    return {
      count: rows.length,
      sum: null,
      average: null,
      median: null,
      amountAggregationAvailable: false,
      unavailableReason: "amount_unreadable",
      currencyCode: null,
    };
  }

  const total = minorUnits.reduce((acc, value) => acc + value, BigInt(0));
  const sorted = [...minorUnits].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const middle = sorted.length >> 1;
  const median =
    sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / BigInt(2);

  return {
    count: rows.length,
    sum: fromMinorUnits(total),
    average: fromMinorUnits(total / BigInt(minorUnits.length)),
    median: fromMinorUnits(median),
    amountAggregationAvailable: true,
    unavailableReason: null,
    currencyCode: [...currencies][0],
  };
}

/** `"25.00"` to `2500n`. Null when the stored text is not canonical. */
function toMinorUnits(amount: string | null): bigint | null {
  if (amount === null) return null;
  const match = /^(\d+)\.(\d{2})$/.exec(amount);
  if (!match) return null;
  return BigInt(match[1]) * BigInt(100) + BigInt(match[2]);
}

/** `2500n` to `"25.00"`. */
function fromMinorUnits(value: bigint): string {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const units = absolute / BigInt(100);
  const cents = absolute % BigInt(100);
  return `${negative ? "-" : ""}${units}.${cents.toString().padStart(2, "0")}`;
}

export type AcquisitionRow = {
  readonly dimension: string;
  readonly label: string | null;
  readonly clicks: number;
  readonly ataRegistrations: number;
  readonly activatedLearners: number;
  readonly pocketRegistrations: number;
  readonly firstDeposits: number;
};

/**
 * The acquisition table: one row per partner or campaign, with its funnel.
 *
 * BOUNDED BY CONSTRUCTION. The dimension is an enum member, the limit is capped
 * by the caller, and the query counts rows rather than returning them — no lead,
 * no email, no click id and no player id can leave through this surface.
 */
export async function loadAcquisitionBreakdown(
  db: PrismaClient,
  period: GrowthPeriod,
  dimension: Extract<GrowthDimension, "affiliatePartner" | "affiliateCampaign" | "trackingLink">,
  limit: number,
): Promise<AcquisitionRow[]> {
  const partners =
    dimension === "affiliatePartner"
      ? await db.affiliatePartner.findMany({
          select: { id: true, code: true },
          orderBy: { id: "asc" },
          take: limit,
        })
      : dimension === "affiliateCampaign"
        ? await db.affiliateCampaign.findMany({
            select: { id: true, code: true },
            orderBy: { id: "asc" },
            take: limit,
          })
        : await db.affiliateTrackingLink.findMany({
            select: { id: true, displayName: true },
            orderBy: { id: "asc" },
            take: limit,
          });

  return Promise.all(
    partners.map(async (row) => {
      const filters: GrowthFilters =
        dimension === "affiliatePartner"
          ? { affiliatePartnerId: row.id }
          : dimension === "affiliateCampaign"
            ? { affiliateCampaignId: row.id }
            : { trackingLinkId: row.id };

      const [clicks, ataRegistrations, activatedLearners, pocketRegistrations, firstDeposits] =
        await Promise.all([
          countClicks(db, period, filters, "attributed"),
          countLedgerEvents(db, period, filters, "attributed", "ata_reg"),
          countLedgerEvents(db, period, filters, "attributed", "academy_activation"),
          countLedgerEvents(db, period, filters, "attributed", "pocket_reg"),
          countLedgerEvents(db, period, filters, "attributed", "dep"),
        ]);

      return {
        dimension,
        label: "code" in row ? row.code : row.displayName,
        clicks,
        ataRegistrations,
        activatedLearners,
        pocketRegistrations,
        firstDeposits,
      };
    }),
  );
}

export type IngressHealthCounts = {
  readonly byGoal: Record<string, number>;
  readonly byStatus: Record<string, number>;
  readonly byRejectionCode: Record<string, number>;
  readonly total: number;
};

/**
 * Provider ingress health.
 *
 * COUNTS ONLY. No sanitized payload, no click id, no player id and no hash
 * leaves this function — an operator needs to know how many deliveries were
 * refused and why, not what was in them, and a surface that returned payloads
 * would be a way to read provider traffic through the CRM.
 */
export async function loadIngressHealth(
  db: Pick<PrismaClient, "providerIngressEvent">,
  period: GrowthPeriod,
): Promise<IngressHealthCounts> {
  const window = { receivedAt: { gte: period.start, lt: period.end } };

  const [byGoal, byStatus, byRejection, total] = await Promise.all([
    db.providerIngressEvent.groupBy({ by: ["goal"], where: window, _count: { _all: true } }),
    db.providerIngressEvent.groupBy({
      by: ["processingStatus"],
      where: window,
      _count: { _all: true },
    }),
    db.providerIngressEvent.groupBy({
      by: ["rejectionCode"],
      where: { ...window, rejectionCode: { not: null } },
      _count: { _all: true },
    }),
    db.providerIngressEvent.count({ where: window }),
  ]);

  return {
    byGoal: Object.fromEntries(byGoal.map((row) => [row.goal, row._count._all])),
    byStatus: Object.fromEntries(byStatus.map((row) => [row.processingStatus, row._count._all])),
    byRejectionCode: Object.fromEntries(
      byRejection.map((row) => [row.rejectionCode ?? "unknown", row._count._all]),
    ),
    total,
  };
}

export { GROWTH_METRIC_KEYS };
