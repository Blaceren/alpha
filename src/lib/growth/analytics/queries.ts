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

export type ClickCohortFunnel = {
  /** Qualified clicks whose OWN occurrence falls in the period. The cohort. */
  readonly clicks: number;
  /** Of those clicks, how many produced at least one canonical registration. */
  readonly convertedClicks: number;
  /** Distinct learners whose frozen attribution names a click in the cohort. */
  readonly registeredLearners: number;
  /** Of those learners, how many later activated / registered with Pocket / deposited. */
  readonly activatedLearners: number;
  readonly pocketRegisteredLearners: number;
  readonly depositedLearners: number;
  /** Of the cohort's Pocket-registered learners, how many deposited. */
  readonly depositedAmongPocketRegistered: number;
};

export const ZERO_CLICK_COHORT: ClickCohortFunnel = {
  clicks: 0,
  convertedClicks: 0,
  registeredLearners: 0,
  activatedLearners: 0,
  pocketRegisteredLearners: 0,
  depositedLearners: 0,
  depositedAmongPocketRegistered: 0,
};

/**
 * G4-R2 — the acquisition funnel on a CLICK-COHORT basis.
 *
 * WHAT WENT WRONG TWICE. `ataRegistrationRate = ata_reg events in the period ÷
 * qualified clicks in the period` reads as a click-to-registration conversion
 * and is not one. The two counts share a filter and a period but not a
 * POPULATION: a click is counted in the period it happened, a registration in
 * the period IT happened, and a learner who clicks in January and registers in
 * February is counted once on each side of a boundary they never crossed
 * together. The first deep audit measured 683% from that; the fix wave narrowed
 * the scope and left the arithmetic, and the re-audit measured 683% again from
 * 41 January clicks converting in February against 6 February clicks. The same
 * shape produced 583% on `activationRate`.
 *
 * THE FIX IS A COHORT, NOT A CLAMP. One population is chosen as the anchor — the
 * CLICKS THAT HAPPENED IN THE PERIOD — and every other number is a property OF
 * THAT SAME SET:
 *
 *   clicks                  the cohort: qualified clicks with their own
 *                           occurredAt in the period, matching the row's filter
 *   convertedClicks         ⊆ clicks. Clicks that produced a canonical ata_reg.
 *   registeredLearners      learners whose FROZEN attribution names a cohort
 *                           click. One learner per click at most in practice,
 *                           but counted distinctly either way.
 *   activatedLearners       ⊆ registeredLearners
 *   pocketRegisteredLearners ⊆ registeredLearners
 *   depositedLearners       ⊆ registeredLearners
 *   depositedAmongPocketRegistered ⊆ pocketRegisteredLearners
 *
 * Every published rate divides one of these by the set it is drawn from, so no
 * rate can exceed 1 by construction. Nothing is clamped and nothing is capped:
 * a value above 1 is now unrepresentable rather than hidden.
 *
 * DOWNSTREAM STATE IS OBSERVED WITHOUT A SECOND DATE WINDOW, DELIBERATELY. §24
 * asks for the cohort's downstream behaviour rather than "every activation event
 * in the window", and those are different questions: a January cohort that
 * activates in March has activated, and a surface that only counted March
 * activations against March clicks would answer neither question. The API states
 * this in `cohortBasis` so nobody has to infer it.
 *
 * ONE STATEMENT, FULLY PARAMETERISED. `scope` and `filters` are validated enum
 * members and positive integers before they arrive, and every value below is a
 * bound parameter.
 */
export async function loadClickCohortFunnel(
  db: Pick<PrismaClient, "$queryRaw">,
  period: GrowthPeriod,
  filters: GrowthFilters,
): Promise<ClickCohortFunnel> {
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
  const linkFilter =
    conditions.length === 0
      ? Prisma.empty
      : Prisma.sql` AND ${Prisma.join(conditions, " AND ")}`;

  const rows = await db.$queryRaw<Array<Record<string, number | bigint | null>>>(Prisma.sql`
    WITH cohort AS (
      SELECT c."id" AS "clickId"
      FROM "AffiliateClick" c
      JOIN "AffiliateTrackingLink" l ON l."id" = c."trackingLinkId"
      WHERE c."classification" = 'qualified'
        AND c."occurredAt" >= ${period.start}
        AND c."occurredAt" < ${period.end}
        ${linkFilter}
    ),
    registered AS (
      SELECT DISTINCT g."userId" AS uid, g."acquisitionClickId" AS "clickId"
      FROM "GrowthEvent" g
      WHERE g."eventType" = 'ata_reg'
        AND g."userId" IS NOT NULL
        AND g."acquisitionClickId" IN (SELECT "clickId" FROM cohort)
    ),
    pocket AS (
      SELECT DISTINCT r.uid FROM registered r
      WHERE EXISTS (SELECT 1 FROM "GrowthEvent" p
                    WHERE p."eventType" = 'pocket_reg' AND p."userId" = r.uid)
    )
    SELECT
      (SELECT COUNT(*) FROM cohort) AS "clicks",
      (SELECT COUNT(DISTINCT "clickId") FROM registered) AS "convertedClicks",
      (SELECT COUNT(DISTINCT uid) FROM registered) AS "registeredLearners",
      (SELECT COUNT(DISTINCT r.uid) FROM registered r
        WHERE EXISTS (SELECT 1 FROM "GrowthEvent" a
                      WHERE a."eventType" = 'academy_activation' AND a."userId" = r.uid)
      ) AS "activatedLearners",
      (SELECT COUNT(*) FROM pocket) AS "pocketRegisteredLearners",
      (SELECT COUNT(DISTINCT r.uid) FROM registered r
        WHERE EXISTS (SELECT 1 FROM "GrowthEvent" d
                      WHERE d."eventType" = 'dep' AND d."userId" = r.uid)
      ) AS "depositedLearners",
      (SELECT COUNT(DISTINCT p.uid) FROM pocket p
        WHERE EXISTS (SELECT 1 FROM "GrowthEvent" d
                      WHERE d."eventType" = 'dep' AND d."userId" = p.uid)
      ) AS "depositedAmongPocketRegistered"
  `);

  const row = rows[0] ?? {};
  const n = (key: string) => Number(row[key] ?? 0);

  return {
    clicks: n("clicks"),
    convertedClicks: n("convertedClicks"),
    registeredLearners: n("registeredLearners"),
    activatedLearners: n("activatedLearners"),
    pocketRegisteredLearners: n("pocketRegisteredLearners"),
    depositedLearners: n("depositedLearners"),
    depositedAmongPocketRegistered: n("depositedAmongPocketRegistered"),
  };
}

export type ReportCohort = {
  /** Distinct report submissions whose FIRST submission falls in the period. */
  readonly submittedCohort: number;
  /** Of that exact cohort, how many are approved today. A subset. */
  readonly approvedFromCohort: number;
};

/**
 * G4-R5 — report approval on a SUBMISSION-COHORT basis.
 *
 * WHAT WENT WRONG. `reportApprovalRate = report_approved events ÷
 * report_submitted events`, both counted in the requested window, published as
 * an approval rate and declared `events_same_population`. They are not one
 * population: a submission is counted when the learner submitted and an approval
 * when the mentor decided, so any review latency that crosses a period boundary
 * decouples them. Two January submissions approved in February against one
 * February submission published `"2.000000"` — a 200% approval rate.
 *
 * THE QUESTION THIS ANSWERS NOW. "Of the reports SUBMITTED in this period, what
 * share have been approved?" The denominator is the cohort of submissions
 * anchored in the window, and the numerator is that same cohort filtered by its
 * own current source-owned state. Numerator ⊆ denominator by construction.
 *
 * THE ENTITY IS THE SUBMISSION, COUNTED ONCE. Both families key on
 * `submission:<id>` — `report_submitted` from `firstSubmittedAt` (so a
 * resubmission never moves the original into a later period) and
 * `report_approved` from the FIRST approving review. A submit → reject →
 * resubmit → approve history is therefore one denominator row and one numerator
 * row, and revisions cannot push the rate above 1.
 *
 * MATCHED ON `sourceEventId` ALONE, deliberately: the two families declare
 * different `sourceOwner`s (`curriculum_report_submission` and
 * `curriculum_report_review`) precisely because they are derived from different
 * owner tables, and the submission key is the documented thing they share.
 *
 * A PENDING REPORT STAYS IN THE DENOMINATOR. It lowers the rate, which is the
 * truthful answer — excluding it would report "everything we finished, we
 * approved" and call it an approval rate.
 */
export async function loadReportCohort(
  db: Pick<PrismaClient, "$queryRaw">,
  period: GrowthPeriod,
  filters: GrowthFilters,
  scope: CoverageScope,
): Promise<ReportCohort> {
  const acquisition = levelFunnelAcquisitionSql(filters, scope);

  const rows = await db.$queryRaw<Array<Record<string, number | bigint | null>>>(Prisma.sql`
    SELECT
      COUNT(DISTINCT g."sourceEventId") AS "submittedCohort",
      COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM "GrowthEvent" a
        WHERE a."eventType" = 'report_approved'
          AND a."sourceEventId" = g."sourceEventId"
      ) THEN g."sourceEventId" END) AS "approvedFromCohort"
    FROM "GrowthEvent" g
    WHERE g."eventType" = 'report_submitted'
      AND g."occurredAt" >= ${period.start}
      AND g."occurredAt" < ${period.end}
      ${acquisition}
  `);

  const row = rows[0] ?? {};
  return {
    submittedCohort: Number(row.submittedCohort ?? 0),
    approvedFromCohort: Number(row.approvedFromCohort ?? 0),
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
  /** The cohort anchor: qualified clicks from this source in the period. */
  readonly clicks: number;
  readonly convertedClicks: number;
  /** Every count below is a property of the learners THAT cohort produced. */
  readonly registeredLearners: number;
  readonly activatedLearners: number;
  readonly pocketRegisteredLearners: number;
  readonly depositedLearners: number;
  readonly depositedAmongPocketRegistered: number;
};

/**
 * The acquisition table: one row per partner or campaign, with its funnel.
 *
 * BOUNDED BY CONSTRUCTION. The dimension is an enum member, the limit is capped
 * by the caller, and the query counts rows rather than returning them — no lead,
 * no email, no click id and no player id can leave through this surface.
 */
export type AcquisitionBreakdown = {
  readonly rows: AcquisitionRow[];
  /**
   * G4-M9 — how many members the dimension actually has.
   *
   * The rows are the first `limit` members BY ID, with no ranking, which the
   * payload has always said. What it could not say is whether there were more:
   * a reader saw twenty-five campaigns and had no way to tell whether that was
   * all of them or the oldest twenty-five of two hundred, and the oldest can
   * all be dormant while the active ones sit past the cutoff. An absence must
   * be visible as an absence here too.
   */
  readonly totalMembers: number;
  readonly truncated: boolean;
};

export async function loadAcquisitionBreakdown(
  db: PrismaClient,
  period: GrowthPeriod,
  dimension: Extract<GrowthDimension, "affiliatePartner" | "affiliateCampaign" | "trackingLink">,
  limit: number,
): Promise<AcquisitionBreakdown> {
  const totalMembers =
    dimension === "affiliatePartner"
      ? await db.affiliatePartner.count()
      : dimension === "affiliateCampaign"
        ? await db.affiliateCampaign.count()
        : await db.affiliateTrackingLink.count();

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

  const rows = await Promise.all(
    partners.map(async (row) => {
      const filters: GrowthFilters =
        dimension === "affiliatePartner"
          ? { affiliatePartnerId: row.id }
          : dimension === "affiliateCampaign"
            ? { affiliateCampaignId: row.id }
            : { trackingLinkId: row.id };

      // G4-R2. ONE cohort query per row, scoped to that row's own filter, so
      // every number on the row describes the same set of clicks. The previous
      // form issued five independent counts and divided them by each other,
      // which is how a campaign's activations could be divided by a different
      // period's registrations.
      const cohort = await loadClickCohortFunnel(db, period, filters);

      return {
        dimension,
        label: "code" in row ? row.code : row.displayName,
        clicks: cohort.clicks,
        convertedClicks: cohort.convertedClicks,
        registeredLearners: cohort.registeredLearners,
        activatedLearners: cohort.activatedLearners,
        pocketRegisteredLearners: cohort.pocketRegisteredLearners,
        depositedLearners: cohort.depositedLearners,
        depositedAmongPocketRegistered: cohort.depositedAmongPocketRegistered,
      };
    }),
  );

  return { rows, totalMembers, truncated: totalMembers > rows.length };
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

export type RegistrationOriginCoverage = {
  /** Every account that exists. */
  readonly population: number;
  /** Accounts holding a canonical `ata_reg`, i.e. a provable registration. */
  readonly provable: number;
  /** Accounts with no provable origin that a staff profile explains. */
  readonly unprovableStaff: number;
  /** Accounts with no provable origin and no explanation at all. */
  readonly unprovableOther: number;
};

/**
 * G4-R12 — how much of the account population the registration figure covers.
 *
 * WHY THIS IS PUBLISHED. `ataRegistrations` is exact and canonical: it counts
 * accounts with a PROVABLE self-service registration record, and set equality
 * against the audited registration path holds in both directions. What it is
 * not is the number of accounts on the platform. On a database carrying
 * accounts created before the audited path existed, or created by an operator,
 * the two differ — which is why «Активированы» can legitimately exceed
 * «Регистрации ATA» and look like a data error when it is a coverage fact.
 *
 * NOT A CORRECTION TO THE METRIC. The count does not change and no denominator
 * is widened: every dependent rate stays a subset ratio over the registered
 * cohort, which is what makes them bounded. This block only lets the reader see
 * the scope the number was always computed over.
 *
 * ORIGIN IS NEVER INFERRED. An account with no registration record and no staff
 * profile is reported as exactly that — unprovable — and is not guessed into
 * either bucket. §49 forbids recording uncertainty as a registration, and the
 * same rule applies to describing it.
 *
 * PERIOD-INDEPENDENT BY CONSTRUCTION. This is a property of the account
 * population and of the ledger's coverage of it, not of the selected window, so
 * it does not take a period. Reading it through a period filter would produce a
 * different, meaningless number for every selector position.
 */
export async function loadRegistrationOriginCoverage(
  db: Pick<PrismaClient, "user" | "growthEvent" | "staffProfile">,
): Promise<RegistrationOriginCoverage> {
  const [population, provableRows, staffRows] = await Promise.all([
    db.user.count(),
    db.growthEvent.findMany({
      where: { eventType: "ata_reg" },
      select: { userId: true },
      distinct: ["userId"],
    }),
    db.staffProfile.findMany({ select: { userId: true }, distinct: ["userId"] }),
  ]);

  const provableUserIds = new Set(
    provableRows.map((row) => row.userId).filter((id): id is number => id !== null),
  );
  const staffUserIds = new Set(staffRows.map((row) => row.userId));

  // A learner who self-registered and was LATER promoted to staff keeps their
  // registration record and stays in `provable`: origin is historical, role is
  // current. Only accounts with NO provable origin are explained by staffing.
  let unprovableStaff = 0;
  for (const userId of staffUserIds) {
    if (!provableUserIds.has(userId)) unprovableStaff += 1;
  }

  const provable = provableUserIds.size;
  const unprovableOther = Math.max(0, population - provable - unprovableStaff);

  return { population, provable, unprovableStaff, unprovableOther };
}

export { GROWTH_METRIC_KEYS };
