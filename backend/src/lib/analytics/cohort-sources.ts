/**
 * AFD-5B2A — the registered acquisition cohort, and the authoritative owner of
 * every timestamp it reports.
 *
 * ============================================================================
 * WHAT THIS POPULATION IS, AND WHAT IT DELIBERATELY IS NOT
 * ============================================================================
 *
 * `registered_acquisition_cohort` — attributed REGISTERED learners whose frozen
 * selected acquisition click happened inside the cohort interval, and whose
 * Academy registration had already happened by the report cutoff.
 *
 * IT IS NOT "every visitor who clicked in January". It cannot be, and the
 * reason is structural rather than a missing feature:
 *
 *   * `AffiliateAttribution` is written only on SUCCESSFUL REGISTRATION;
 *   * `selectedClickId` — the frozen answer to "which click acquired this
 *     learner" — comes into existence at that same moment;
 *   * an anonymous visitor who never registers therefore has NO selected click,
 *     and nothing in the database says which of their clicks would have been
 *     selected had they registered;
 *   * choosing one at query time would be inventing attribution, and inventing
 *     it in a way that changes whenever the query is re-run.
 *
 * So `anonymousVisitorToRegistrationCohortRate` is reported UNAVAILABLE with the
 * reason `unregistered_visitor_selected_attribution_not_frozen`, and no
 * click-to-registration cohort rate is computed. AFD-5B1's event-date period
 * ratio remains available separately, carrying its own warning that it is not a
 * cohort conversion probability.
 *
 * ============================================================================
 * WHY THE ANCHOR IS THE SELECTED CLICK AND NOTHING ELSE
 * ============================================================================
 *
 * A cohort is only meaningful if a learner's membership can never move. The
 * selected click is the one fact about acquisition that AFD-3B2 froze at
 * registration and that no later event rewrites:
 *
 *   * NOT first touch — a learner whose first touch was Alpha and whose selected
 *     touch was Beta belongs to Beta. Anchoring on first touch would report a
 *     cohort under an affiliate that the attribution model did not credit.
 *   * NOT last touch RECOMPUTED — recomputing "most recent click" at query time
 *     makes yesterday's report disagree with today's for the same period.
 *   * NOT the registration date — that is a registration cohort, a different
 *     question, and calling it an acquisition cohort would put every direct
 *     learner into an affiliate's row.
 *   * NOT the Pocket registration or first-deposit date — those are the
 *     conversions being measured; using one as the anchor would guarantee a
 *     100% rate.
 *   * NOT the CURRENT status of the link or affiliate — an archived partner
 *     still acquired the learners it acquired.
 *
 * ============================================================================
 * ONE OWNER PER TIMESTAMP
 * ============================================================================
 *
 *   selected click        AffiliateClick.occurredAt      via AffiliateAttribution.selectedClickId
 *   Academy registration  AffiliateConversionEvent.occurredAt   eventType=academy_registration
 *   Pocket registration   PocketTraderIdentity.boundAt          source=registration_postback
 *   first deposit         AffiliateConversionEvent.occurredAt   eventType=first_deposit
 *
 * These are exactly AFD-5B1's owners, unchanged. `User.createdAt` is NOT used as
 * the registration time: the conversion ledger is the authoritative record of a
 * registration having happened, it is what carries the attribution, and nothing
 * proves the two columns are equal. Session creation, login, enrolment and L1
 * completion are all rejected for the same reason — they follow registration but
 * no contract makes them identical to it.
 *
 * ============================================================================
 * NO LOOK-AHEAD
 * ============================================================================
 *
 * Every downstream timestamp is bounded by the cutoff INSIDE THE JOIN, not
 * filtered afterwards. A learner whose Pocket registration happens after the
 * cutoff joins to nothing and is honestly reported as not-yet-converted, rather
 * than being counted and then subtracted. Re-running the same report with the
 * same cutoff therefore returns the same answer forever.
 *
 * ============================================================================
 * EXACTLY ONCE PER LEARNER
 * ============================================================================
 *
 * `AffiliateAttribution.userId` is UNIQUE, so a learner has at most one frozen
 * attribution and appears at most once in the cohort. The two conversion joins
 * are aggregated per user rather than joined row-to-row, so a learner with two
 * first-deposit rows still counts once — and the anomaly is surfaced as an
 * integrity warning instead of silently doubling a numerator.
 */
import { Prisma } from "@prisma/client";
import type { AnalyticsFilters } from "@/lib/analytics/affiliate-sources";

export const COHORT_MODE = "acquisition_cohort";
export const COHORT_POPULATION = "registered_attributed_learners";
export const COHORT_ANCHOR = "selected_acquisition_click";

/**
 * The classification a click must carry to anchor a cohort.
 *
 * Prefetch clicks are made by a link scanner, not a person, and
 * authenticated-user clicks carry no anonymous visitor journey. Neither can
 * legitimately acquire a learner, and AFD-3B2's selector already refuses to
 * select them — this predicate states the rule rather than trusting it.
 */
export const QUALIFIED_CLICK = "qualified";

export type CohortScope = {
  readonly filters: AnalyticsFilters;
  /** Inclusive. Null only for an all-time cohort, which has no left edge. */
  readonly startUtc: Date | null;
  /** Exclusive. */
  readonly endUtc: Date;
  /** Exclusive. No conversion at or after this instant is observed. */
  readonly cutoffUtc: Date;
};

/**
 * The three conversion stages, named once so a metric, a lag and a query plan
 * cannot drift apart.
 */
export const COHORT_STAGES = ["academyRegistration", "pocketRegistration", "firstDeposit"] as const;
export type CohortStage = (typeof COHORT_STAGES)[number];

/** The lag metrics, each a pair of stage timestamps on the same learner. */
export const LAG_KEYS = [
  "selectedClickToAcademyRegistration",
  "academyRegistrationToPocketRegistration",
  "pocketRegistrationToFirstDeposit",
  "selectedClickToFirstDeposit",
] as const;
export type LagKey = (typeof LAG_KEYS)[number];

/**
 * The duration column for one lag, in EXACT INTEGER MILLISECONDS.
 *
 * Milliseconds, not seconds, at this level: the subtraction of two stored
 * instants is exact integer arithmetic, and rounding before the sign has been
 * checked would let a small negative duration disappear into zero instead of
 * being reported as the integrity error it is.
 */
export function lagDurationMs(lag: LagKey): Prisma.Sql {
  switch (lag) {
    case "selectedClickToAcademyRegistration":
      return Prisma.sql`(s."regAt" - s."clickAt")`;
    case "academyRegistrationToPocketRegistration":
      return Prisma.sql`(s."pocketAt" - s."regAt")`;
    case "pocketRegistrationToFirstDeposit":
      return Prisma.sql`(s."fdAt" - s."pocketAt")`;
    case "selectedClickToFirstDeposit":
      return Prisma.sql`(s."fdAt" - s."clickAt")`;
  }
}

/**
 * Dimension filters over the SELECTED CLICK's link.
 *
 * The link is reached through the frozen selected click, never through a later
 * click and never through the learner's current associations, so filtering by
 * an affiliate returns the learners that affiliate actually acquired.
 */
function filterClause(filters: AnalyticsFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (filters.affiliatePartnerId !== undefined) {
    parts.push(Prisma.sql`AND l."affiliatePartnerId" = ${filters.affiliatePartnerId}`);
  }
  if (filters.affiliateCampaignId !== undefined) {
    parts.push(Prisma.sql`AND l."affiliateCampaignId" = ${filters.affiliateCampaignId}`);
  }
  if (filters.affiliateTrackingLinkId !== undefined) {
    parts.push(Prisma.sql`AND l."id" = ${filters.affiliateTrackingLinkId}`);
  }
  return parts.length === 0 ? Prisma.empty : Prisma.join(parts, " ");
}

/**
 * One row per cohort learner, carrying every fact the report needs.
 *
 * WHY ONE STREAM RATHER THAN A QUERY PER METRIC. Counts, rates, medians, buckets
 * and all three breakdowns are aggregations over the SAME population. Deriving
 * them from one definition is what makes the summary, the series and the
 * breakdown reconcile by construction instead of by three implementations
 * agreeing — and it means the cohort predicate is written down exactly once.
 *
 * COLUMNS
 *   uid       the learner, for nothing but de-duplication — never returned
 *   clickAt   the frozen selected click instant (the cohort anchor)
 *   regAt     the authoritative Academy registration instant
 *   pocketAt  trusted Pocket registration, or NULL when not yet observed
 *   fdAt      confirmed first deposit, or NULL when not yet observed
 *   pid/cid/lid  affiliate, campaign and link OF THE SELECTED CLICK
 *   fdAmt/fdCurst/fdCur  the confirmed deposit's reported money
 *   fdCount   how many confirmed deposits the learner has (an anomaly if > 1)
 *
 * THE DRIVING SCAN is `AffiliateClick(classification, occurredAt)` — the cohort
 * interval applies to the click, so the index that orders clicks by
 * classification and time is the one that selects the population. Everything
 * else is an equality seek on a unique or indexed key from there.
 */
export function cohortMemberStream(scope: CohortScope): Prisma.Sql {
  const lower =
    scope.startUtc === null ? Prisma.empty : Prisma.sql`AND sc."occurredAt" >= ${scope.startUtc}`;

  return Prisma.sql`
    SELECT
      a."userId"              AS "uid",
      sc."occurredAt"         AS "clickAt",
      reg."at"                AS "regAt",
      pi."boundAt"            AS "pocketAt",
      fd."at"                 AS "fdAt",
      l."affiliatePartnerId"  AS "pid",
      l."affiliateCampaignId" AS "cid",
      l."id"                  AS "lid",
      -- Money is withheld from a learner carrying more than one confirmed
      -- deposit: the per-column MIN below would be free to take the amount from
      -- one row and the currency from another, and a total assembled that way
      -- would be arithmetically exact and factually invented.
      CASE WHEN fd."n" = 1 THEN fd."amt"   ELSE NULL END AS "fdAmt",
      CASE WHEN fd."n" = 1 THEN fd."curst" ELSE NULL END AS "fdCurst",
      CASE WHEN fd."n" = 1 THEN fd."cur"   ELSE NULL END AS "fdCur",
      fd."n"                  AS "fdCount"
    FROM "AffiliateClick" sc
    JOIN "AffiliateAttribution" a
      ON a."selectedClickId" = sc."id"
    JOIN "AffiliateTrackingLink" l
      ON l."id" = sc."trackingLinkId"
    -- Academy registration is a MEMBERSHIP predicate, not an optional extra: a
    -- cohort learner is by definition one who registered.
    --
    -- THE GROUP IS NOT CUTOFF-BOUNDED, and the distinction matters. The count
    -- asks a STRUCTURAL question — does this attributed learner have exactly one
    -- authoritative registration event — whose answer must not depend on which
    -- report is being run. The cutoff is then applied to the event's own
    -- instant, below. Counting only pre-cutoff rows would make a learner who
    -- registers next week look malformed today.
    JOIN (
      SELECT r."userId" AS "uid", MIN(r."occurredAt") AS "at", COUNT(*) AS "n"
      FROM "AffiliateConversionEvent" r
      WHERE r."eventType" = 'academy_registration'
      GROUP BY r."userId"
    ) reg ON reg."uid" = a."userId" AND reg."n" = 1
    -- Trusted Pocket registration. userId is UNIQUE on this table, so this is
    -- at most one row and needs no aggregation. The cutoff lives in the JOIN so
    -- a later binding is invisible rather than counted-then-removed.
    LEFT JOIN "PocketTraderIdentity" pi
      ON pi."userId" = a."userId"
     AND pi."source" = 'registration_postback'
     AND pi."boundAt" < ${scope.cutoffUtc}
    -- Confirmed first deposit, aggregated per user so one learner counts once
    -- however many rows exist. The money travels with the EARLIEST deposit.
    LEFT JOIN (
      SELECT
        d."userId"                  AS "uid",
        MIN(d."occurredAt")         AS "at",
        COUNT(*)                    AS "n",
        MIN(d."providerAmount")     AS "amt",
        MIN(d."currencyStatus")     AS "curst",
        MIN(d."currencyCode")       AS "cur"
      FROM "AffiliateConversionEvent" d
      WHERE d."eventType" = 'first_deposit'
        AND d."occurredAt" < ${scope.cutoffUtc}
      GROUP BY d."userId"
    ) fd ON fd."uid" = a."userId"
    WHERE sc."classification" = ${QUALIFIED_CLICK}
      AND sc."occurredAt" < ${scope.endUtc}
      ${lower}
      -- The cutoff, applied to registration: a learner who registers AFTER the
      -- report cutoff is honestly not yet a member of the observed cohort, and
      -- becomes one only when a later cutoff is chosen.
      AND reg."at" < ${scope.cutoffUtc}
      ${filterClause(scope.filters)}
  `;
}

/**
 * Attributed learners in the acquisition interval whose Academy registration is
 * MISSING or DUPLICATED, and who are therefore absent from the cohort.
 *
 * THIS IS NOT THE LATE-REGISTRATION EXCLUSION. A learner who registers after the
 * cutoff is perfectly well-formed and simply has not been observed yet; they
 * reappear when a later cutoff is chosen and they are NOT counted here. This
 * count is deliberately cutoff-independent and reports only rows the ledger
 * itself contradicts: no authoritative registration event at all, or more than
 * one.
 *
 * Surfaced as a bounded count so an operator can see that a learner was withheld
 * rather than having the row vanish silently. No timestamp is ever invented for
 * them: guessing one from `User.createdAt` would place a learner in a cohort on
 * the strength of a column nothing promises is equal to the registration event.
 */
export function cohortIntegrityStream(scope: CohortScope): Prisma.Sql {
  const lower =
    scope.startUtc === null ? Prisma.empty : Prisma.sql`AND sc."occurredAt" >= ${scope.startUtc}`;

  return Prisma.sql`
    SELECT a."userId" AS "uid"
    FROM "AffiliateClick" sc
    JOIN "AffiliateAttribution" a
      ON a."selectedClickId" = sc."id"
    JOIN "AffiliateTrackingLink" l
      ON l."id" = sc."trackingLinkId"
    LEFT JOIN (
      SELECT r."userId" AS "uid", COUNT(*) AS "n"
      FROM "AffiliateConversionEvent" r
      WHERE r."eventType" = 'academy_registration'
      GROUP BY r."userId"
    ) reg ON reg."uid" = a."userId"
    WHERE sc."classification" = ${QUALIFIED_CLICK}
      AND sc."occurredAt" < ${scope.endUtc}
      ${lower}
      ${filterClause(scope.filters)}
      AND COALESCE(reg."n", 0) <> 1
  `;
}
