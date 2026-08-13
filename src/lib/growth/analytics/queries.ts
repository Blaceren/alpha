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

export type CoverageScope = "attributed" | "unattributed" | "total";

/**
 * Turn filters plus a coverage scope into the ledger-side acquisition predicate.
 *
 * `unattributed` is `acquisitionClickId IS NULL`, and it is a FIRST-CLASS
 * category rather than a residual. A learner who arrived organically is a real
 * learner, and a funnel that silently omitted them would report a registration
 * total smaller than the platform's own user count with no visible reason.
 */
function ledgerAcquisitionWhere(
  filters: GrowthFilters,
  scope: CoverageScope,
): Prisma.GrowthEventWhereInput {
  if (scope === "unattributed") return { acquisitionClickId: null };

  const click = clickWhere(filters);
  const filtered = Object.keys(click).length > 0;

  if (scope === "attributed") {
    return filtered
      ? { acquisitionClick: click }
      : { acquisitionClickId: { not: null } };
  }

  // `total` with filters cannot include unattributed rows: events belonging to
  // nobody cannot belong to the campaign that was asked about. Returning them
  // anyway would answer a question the caller did not pose.
  return filtered ? { acquisitionClick: click } : {};
}

/** Count qualified clicks in the period. The accepted AFD-5B1 owner. */
export async function countClicks(
  db: Pick<PrismaClient, "affiliateClick">,
  period: GrowthPeriod,
  filters: GrowthFilters,
  scope: CoverageScope,
): Promise<number> {
  // An unattributed slice has no clicks BY CONSTRUCTION: a click is the thing
  // that creates attribution, so "clicks with no acquisition click" is not a
  // small number, it is a category error. Zero here is exact, not a placeholder.
  if (scope === "unattributed") return 0;

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
  readonly started: number;
  readonly completed: number;
};

/**
 * The per-level funnel.
 *
 * ONE GROUPED QUERY PER EVENT TYPE, not one query per level. A hundred-level
 * curriculum would otherwise mean two hundred round trips per dashboard load,
 * and the index `(eventType, levelNumber, occurredAt)` exists precisely so this
 * grouping is cheap.
 *
 * A LEVEL WITH NO EVENTS IS ABSENT FROM THE RESULT, not present as zero. The
 * caller decides whether "no learner reached L47 in this period" should render
 * as a zero row or as nothing at all — a query should not make that editorial
 * choice on its behalf.
 */
export async function loadLevelFunnel(
  db: Pick<PrismaClient, "growthEvent">,
  period: GrowthPeriod,
  filters: GrowthFilters,
  scope: CoverageScope,
  maxLevel: number,
): Promise<LevelFunnelStep[]> {
  const base: Prisma.GrowthEventWhereInput = {
    occurredAt: { gte: period.start, lt: period.end },
    levelNumber: { not: null, lte: maxLevel },
    ...ledgerAcquisitionWhere(filters, scope),
  };

  const [started, completed] = await Promise.all([
    db.growthEvent.groupBy({
      by: ["levelNumber"],
      where: { ...base, eventType: "level_started" },
      _count: { _all: true },
    }),
    db.growthEvent.groupBy({
      by: ["levelNumber"],
      where: { ...base, eventType: "level_completed" },
      _count: { _all: true },
    }),
  ]);

  const byLevel = new Map<number, { started: number; completed: number }>();

  for (const row of started) {
    if (row.levelNumber === null) continue;
    byLevel.set(row.levelNumber, { started: row._count._all, completed: 0 });
  }
  for (const row of completed) {
    if (row.levelNumber === null) continue;
    const entry = byLevel.get(row.levelNumber) ?? { started: 0, completed: 0 };
    entry.completed = row._count._all;
    byLevel.set(row.levelNumber, entry);
  }

  return [...byLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([levelNumber, value]) => ({ levelNumber, ...value }));
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
