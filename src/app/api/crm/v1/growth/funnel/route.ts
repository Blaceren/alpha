import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exactRatio } from "@/lib/analytics/decimal";
import { resolvePeriod } from "@/lib/analytics/periods";
import {
  analyticsErrorResponse,
  beginAnalyticsRequest,
  openAnalyticsRequest,
  serializePeriod,
} from "@/lib/analytics/routes";
import { assertKnownAnalyticsKeys, parsePeriodInput } from "@/lib/analytics/request";
import {
  GROWTH_ANALYTICS_MODE,
  GROWTH_DEFAULT_COVERAGE_SCOPE,
  computeAttributionCoverage,
  computeLearnerFunnelRatios,
} from "@/lib/growth/analytics/sources";
import {
  countLedgerEvents,
  loadGrowthCounts,
  loadLearnerFunnel,
  loadLevelFunnel,
} from "@/lib/growth/analytics/queries";
import {
  GROWTH_ATTRIBUTION_EXPLANATION,
  buildGrowthAvailability,
} from "@/lib/growth/analytics/availability";
import {
  GROWTH_COMMON_KEYS,
  assertGrowthFilterHierarchy,
  parseFunnelMaxLevel,
  parseGrowthFilters,
  parseGrowthScope,
} from "@/lib/growth/analytics/request";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const KEYS = [...GROWTH_COMMON_KEYS, "maxLevel"] as const;

/**
 * GET /api/crm/v1/growth/funnel
 *
 * The CRO surface: where learners stop, from the click to the level they reached.
 *
 * TWO FUNNELS, NOT ONE, BECAUSE THEY ANSWER DIFFERENT QUESTIONS. The acquisition
 * steps (click → registration → enrollment → activation) are counts of DISTINCT
 * BUSINESS EVENTS that happen at most once per learner. The level steps are
 * counts of level events, where one learner contributes to many levels. Merging
 * them into a single descending list would produce a "funnel" whose later steps
 * are not subsets of its earlier ones — the classic chart that cannot be wrong
 * because it does not mean anything.
 *
 * DROP-OFF IS COMPUTED, NOT INFERRED FROM ORDERING. Each step names the step it
 * is a fraction OF, so a reader never has to assume that the row above is the
 * denominator.
 */
export async function GET(request: Request) {
  const { requestId, headers } = beginAnalyticsRequest();

  try {
    const { params, timezone, now } = await openAnalyticsRequest(request);
    assertKnownAnalyticsKeys(params, KEYS);

    const filters = parseGrowthFilters(params);
    await assertGrowthFilterHierarchy(filters);
    const period = resolvePeriod(parsePeriodInput(params), timezone, now);
    const maxLevel = parseFunnelMaxLevel(params);
    // G4-H4. `total` unless the caller asks otherwise. See parseGrowthScope.
    const scope = parseGrowthScope(params);

    const window = { start: period.startUtc ?? new Date(0), end: period.endUtc };

    const [counts, levels, learners, attributedRegistrations, totalRegistrations] =
      await Promise.all([
        loadGrowthCounts(prisma, window, filters, scope),
        loadLevelFunnel(prisma, window, filters, scope, maxLevel),
        loadLearnerFunnel(prisma, window, filters, scope),
        countLedgerEvents(prisma, window, filters, "attributed", "ata_reg"),
        countLedgerEvents(prisma, window, filters, "total", "ata_reg"),
      ]);
    const learnerRates = computeLearnerFunnelRatios(learners);

    // Each step states its own denominator, and the accepted exact-decimal
    // helper computes it: `null` — never zero — when that denominator is zero,
    // so "no traffic yet" cannot render as "0% converted".
    const rate = exactRatio;

    const acquisitionSteps = [
      { step: "click", count: counts.clicks, learners: null, ofStep: null, ofLearners: null, rate: null, dropOff: null },
      {
        step: "ata_registration",
        count: counts.ataRegistrations,
        learners: learners.registeredLearners,
        ofLearners: scope === "attributed" ? counts.clicks : null,
        // G4-H3. A click denominator only exists for the attributed population.
        // In `total` and `organic` the numerator contains learners no tracking
        // link could have produced, so the step states that it has no rate here
        // rather than publishing one that reads above 100%.
        ofStep: scope === "attributed" ? "click" : null,
        rate: scope === "attributed" ? rate(counts.ataRegistrations, counts.clicks) : null,
        dropOff: scope === "attributed" ? counts.clicks - counts.ataRegistrations : null,
      },
      // G4-H3. `count` is the EVENT count — "19 enrollments happened" is true and
      // useful. `rate` is a UNIQUE-LEARNER SUBSET fraction of the registered
      // population, because the event quotient divided two populations that are
      // not nested and reported 158% on real PREPROD data. `learners` names the
      // numerator's own basis so the two can never be confused.
      {
        step: "enrollment",
        count: counts.enrollments,
        learners: learners.enrolledLearners,
        ofStep: "ata_registration",
        ofLearners: learners.registeredLearners,
        rate: learnerRates.enrollmentRate,
        dropOff: learners.registeredLearners - learners.enrolledLearners,
      },
      {
        step: "academy_activation",
        count: counts.activatedLearners,
        learners: learners.activatedLearners,
        ofStep: "ata_registration",
        ofLearners: learners.registeredLearners,
        rate: learnerRates.activationRate,
        dropOff: learners.registeredLearners - learners.activatedLearners,
      },
      {
        step: "pocket_registration",
        count: counts.pocketRegistrations,
        learners: learners.pocketRegisteredLearners,
        ofStep: "ata_registration",
        ofLearners: learners.registeredLearners,
        rate: learnerRates.pocketRegistrationRate,
        dropOff: learners.registeredLearners - learners.pocketRegisteredLearners,
      },
      {
        step: "first_deposit",
        count: counts.firstDeposits,
        learners: learners.depositedAmongPocketRegistered,
        ofStep: "pocket_registration",
        ofLearners: learners.pocketRegisteredTotal,
        rate: learnerRates.depositRatePerPocketRegistration,
        dropOff: learners.pocketRegisteredTotal - learners.depositedAmongPocketRegistered,
      },
    ];

    return NextResponse.json(
      {
        mode: GROWTH_ANALYTICS_MODE,
        attributionExplanation: GROWTH_ATTRIBUTION_EXPLANATION,
        period: serializePeriod(period),
        filters: {
          affiliatePartnerId: filters.affiliatePartnerId ?? null,
          affiliateCampaignId: filters.affiliateCampaignId ?? null,
          trackingLinkId: filters.trackingLinkId ?? null,
        },
        maxLevel,
        scope,
        defaultScope: GROWTH_DEFAULT_COVERAGE_SCOPE,
        // G4-H4. How much of the business the attributed view can see, so an
        // empty acquisition table is readable as a coverage fact rather than as
        // an absence of customers. Always computed on the TOTAL population, so it
        // is a genuine subset fraction whatever scope was requested.
        attributionCoverage: computeAttributionCoverage({
          attributedRegistrations,
          totalRegistrations,
        }),
        acquisitionFunnel: {
          // Stated explicitly so a client cannot assume the previous row is the
          // denominator when a step is filtered out of a chart.
          denominatorModel: "each_step_states_its_own_ofStep",
          // G4-H3. `count` is events, `learners` is distinct learners, and every
          // `rate` divides `learners` by `ofLearners` — a subset of a set it is
          // drawn from, so no rate can exceed 1.
          rateBasis: "unique_learners_subset_of_ofStep",
          steps: acquisitionSteps,
        },
        levelFunnel: {
          // A level absent from this list had NO events in the period. That is
          // deliberately not the same as a level with zero, and the client is
          // told which it is looking at rather than left to guess.
          absentMeans: "no_events_in_period",
          // G4-H1. Counts are DISTINCT enrollment+level pairs, not events, and
          // the rate is a subset fraction of the started set — so it cannot
          // exceed 100% by construction rather than by clamping.
          countBasis: "distinct_enrollment_level_pairs",
          rateDefinition:
            "startedCompletionRate = startedAndCompletedLearners / startedLearners. " +
            "Both are drawn from the same set, so the rate is always between 0 and 1. " +
            "completedLearners counts every completion in the period, including " +
            "financial-checkpoint levels that cannot be started and therefore have " +
            "no start event — those are reported as completedWithoutStartLearners " +
            "and are never used as a numerator over starts.",
          steps: levels.map((level) => ({
            ...level,
            startedCompletionRate: rate(
              level.startedAndCompletedLearners,
              level.startedLearners,
            ),
          })),
        },
        educationQuality: {
          assessmentsCompleted: counts.assessmentsCompleted,
          assessmentsPassed: counts.assessmentsPassed,
          assessmentPassRate: rate(counts.assessmentsPassed, counts.assessmentsCompleted),
          reportsSubmitted: counts.reportsSubmitted,
          reportsApproved: counts.reportsApproved,
          reportApprovalRate: rate(counts.reportsApproved, counts.reportsSubmitted),
          mentorReviewsSubmitted: counts.mentorReviewsSubmitted,
          mentorReviewsApproved: counts.mentorReviewsApproved,
        },
        dataAvailability: buildGrowthAvailability({
          amountAggregationAvailable: false,
          amountUnavailableReason: "not_requested_on_this_surface",
        }),
        generatedAt: now.toISOString(),
      },
      { headers },
    );
  } catch (error) {
    return analyticsErrorResponse(error, requestId, headers);
  }
}
