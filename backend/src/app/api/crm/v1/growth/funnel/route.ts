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
  computeClickCohortRatios,
  computeLearnerFunnelRatios,
  computeReportCohortRatio,
} from "@/lib/growth/analytics/sources";
import {
  countLedgerEvents,
  loadClickCohortFunnel,
  loadGrowthCounts,
  loadLearnerFunnel,
  loadLevelFunnel,
  loadReportCohort,
  loadRegistrationOriginCoverage,
} from "@/lib/growth/analytics/queries";
import {
  GROWTH_ATTRIBUTION_EXPLANATION,
  buildGrowthAvailability,
} from "@/lib/growth/analytics/availability";
import { resolveRedepositCapability } from "@/lib/growth/ingress-config";
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

    const [
      counts,
      levels,
      learners,
      attributedRegistrations,
      totalRegistrations,
      clickCohort,
      reportCohort,
      registrationOriginCoverage,
    ] = await Promise.all([
        loadGrowthCounts(prisma, window, filters, scope),
        loadLevelFunnel(prisma, window, filters, scope, maxLevel),
        loadLearnerFunnel(prisma, window, filters, scope),
        countLedgerEvents(prisma, window, filters, "attributed", "ata_reg"),
        countLedgerEvents(prisma, window, filters, "total", "ata_reg"),
        // G4-R2. The click step's rate comes from the shared cohort query, not
        // from dividing two independently windowed event counts.
        loadClickCohortFunnel(prisma, window, filters),
        // G4-R5. Report approval is the submission cohort's own share.
        loadReportCohort(prisma, window, filters, scope),
        // G4-R12. See the overview route.
        loadRegistrationOriginCoverage(prisma),
      ]);
    const learnerRates = computeLearnerFunnelRatios(learners);
    const cohortRates = computeClickCohortRatios(clickCohort);

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
        // G4-R2. A click denominator exists only for the attributed population,
        // and even there it must be a COHORT rather than a second event count.
        // `rate` is now "of the clicks that happened in this period, how many
        // produced a registration" — converted clicks over cohort clicks, a
        // subset of the same set. The previous form divided registrations in the
        // window by clicks in the window, which are different populations
        // whenever anyone registers in a later period than they clicked, and it
        // published 683% on exactly that shape.
        ofLearners: scope === "attributed" ? clickCohort.clicks : null,
        ofStep: scope === "attributed" ? "click" : null,
        rate: scope === "attributed" ? cohortRates.attributedClickToRegistrationRate : null,
        dropOff:
          scope === "attributed" ? clickCohort.clicks - clickCohort.convertedClicks : null,
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
          // G4-R2. The first step is the exception and says so: it is a click
          // cohort, not a learner subset.
          clickStepBasis: "attributed_click_cohort_converted_over_cohort",
          clickCohort,
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
          // G4-R5. The two EVENT-VOLUME counts stay, because "seven reports were
          // submitted this month" and "seven were approved this month" are both
          // true and useful. What is no longer published is their quotient.
          reportsSubmitted: counts.reportsSubmitted,
          reportsApproved: counts.reportsApproved,
          // The COHORT: reports whose first submission falls in this period, and
          // how many of those exact reports are approved today. A pending report
          // stays in the denominator and lowers the rate, which is the honest
          // answer. A period that started no reports yields null, not zero.
          submittedReportCohort: reportCohort.submittedCohort,
          approvedFromSubmittedReportCohort: reportCohort.approvedFromCohort,
          submittedReportCohortApprovalRate: computeReportCohortRatio(reportCohort),
          mentorReviewsSubmitted: counts.mentorReviewsSubmitted,
          mentorReviewsApproved: counts.mentorReviewsApproved,
        },
        dataAvailability: buildGrowthAvailability({
          redepositCapability: resolveRedepositCapability(),
          amountAggregationAvailable: false,
          amountUnavailableReason: "not_requested_on_this_surface",
          registrationOriginCoverage,
        }),
        generatedAt: now.toISOString(),
      },
      { headers },
    );
  } catch (error) {
    return analyticsErrorResponse(error, requestId, headers);
  }
}
