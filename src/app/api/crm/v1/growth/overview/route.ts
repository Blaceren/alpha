import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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
  GROWTH_RATE_MODE,
  GROWTH_RATIO_DENOMINATORS,
  computeAttributionCoverage,
  computeClickCohortRatios,
  computeGrowthRatios,
  computeLearnerFunnelRatios,
  computeReportCohortRatio,
  type GrowthCoverageScope,
  type GrowthMetricCounts,
} from "@/lib/growth/analytics/sources";
import {
  loadClickCohortFunnel,
  loadFirstDepositAmounts,
  loadGrowthCounts,
  loadLearnerFunnel,
  loadReportCohort,
  loadRegistrationOriginCoverage,
} from "@/lib/growth/analytics/queries";
import {
  GROWTH_ATTRIBUTION_EXPLANATION,
  GROWTH_RATE_MODE_EXPLANATION,
  buildGrowthAvailability,
} from "@/lib/growth/analytics/availability";
import { resolveRedepositCapability } from "@/lib/growth/ingress-config";
import {
  GROWTH_COMMON_KEYS,
  assertGrowthFilterHierarchy,
  isUnfiltered,
  parseGrowthFilters,
} from "@/lib/growth/analytics/request";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/crm/v1/growth/overview
 *
 * The operational headline: click through to first deposit in one period, with
 * the funnel ratios and an explicit statement of what this deployment can and
 * cannot measure.
 *
 * READ-ONLY BY CONSTRUCTION. `GET` is the only export, so there is no state
 * change to defend with a CSRF token. Authorization is the accepted CRM
 * affiliate-reader boundary, reached before any database read.
 *
 * NO LEARNER ROWS, NO IDENTIFIERS, NO MONEY WITHOUT A UNIT. Every field below is
 * a count, a ratio or a canonical decimal string whose currency is stated.
 */
export async function GET(request: Request) {
  const { requestId, headers } = beginAnalyticsRequest();

  try {
    const { params, timezone, now } = await openAnalyticsRequest(request);
    assertKnownAnalyticsKeys(params, GROWTH_COMMON_KEYS);

    const filters = parseGrowthFilters(params);
    await assertGrowthFilterHierarchy(filters);
    const period = resolvePeriod(parsePeriodInput(params), timezone, now);

    // `resolvePeriod` may return a null start for all-time. The queries take a
    // half-open interval, so an open start becomes the epoch rather than being
    // special-cased in five different places.
    const window = {
      start: period.startUtc ?? new Date(0),
      end: period.endUtc,
    };

    const unfiltered = isUnfiltered(filters);

    // A filtered report has no unattributed slice to show: events belonging to
    // nobody cannot belong to the campaign that was asked about. Computing it
    // anyway would publish a number answering a question nobody posed.
    const [
      attributed,
      organic,
      total,
      amounts,
      learnersAttributed,
      learnersOrganic,
      learnersTotal,
      clickCohort,
      reportCohortAttributed,
      reportCohortOrganic,
      reportCohortTotal,
      registrationOriginCoverage,
    ] = await Promise.all([
      loadGrowthCounts(prisma, window, filters, "attributed"),
      unfiltered ? loadGrowthCounts(prisma, window, filters, "organic") : Promise.resolve(null),
      unfiltered ? loadGrowthCounts(prisma, window, filters, "total") : Promise.resolve(null),
      loadFirstDepositAmounts(prisma, window, filters, unfiltered ? "total" : "attributed"),
      loadLearnerFunnel(prisma, window, filters, "attributed"),
      unfiltered ? loadLearnerFunnel(prisma, window, filters, "organic") : Promise.resolve(null),
      unfiltered ? loadLearnerFunnel(prisma, window, filters, "total") : Promise.resolve(null),
      // G4-R2. The click-denominated rates come from the SAME cohort query the
      // acquisition table uses, so the two surfaces cannot disagree about what a
      // click-to-registration conversion is.
      loadClickCohortFunnel(prisma, window, filters),
      // G4-R5. Report approval is a submission-cohort share, per scope.
      loadReportCohort(prisma, window, filters, "attributed"),
      unfiltered ? loadReportCohort(prisma, window, filters, "organic") : Promise.resolve(null),
      unfiltered ? loadReportCohort(prisma, window, filters, "total") : Promise.resolve(null),
      // G4-R12. Population coverage of the registration authority. Period- and
      // filter-independent by construction: it describes the ledger's reach
      // over the account population, not the selected window.
      loadRegistrationOriginCoverage(prisma),
    ]);

    // G4-H3. Ratios are computed PER SCOPE, and a ratio whose denominator does
    // not exist for that population comes back null instead of dividing two
    // different populations by each other.
    // G4-H3. Event-basis ratios come from `computeGrowthRatios` (which returns
    // null for anything whose populations are not nested); learner-basis subset
    // ratios come from `computeLearnerFunnelRatios`. The two are merged so a
    // client reads one `ratios` object, and `ratioBasis` names which is which.
    const block = (
      counts: GrowthMetricCounts,
      scope: GrowthCoverageScope,
      learners: Awaited<ReturnType<typeof loadLearnerFunnel>> | null,
      reports: Awaited<ReturnType<typeof loadReportCohort>> | null,
    ) => ({
      ...counts,
      learnerFunnel: learners,
      // G4-R5. The cohort counts travel WITH the rate, so a reader can check the
      // arithmetic and can tell a null apart from a zero.
      reportCohort: reports,
      ratios: {
        ...computeGrowthRatios(counts, scope),
        ...(learners ? computeLearnerFunnelRatios(learners) : {}),
        // G4-R2. Click-cohort ratios exist only for the attributed population —
        // a click denominator is meaningless for organic learners, who had none.
        ...(scope === "attributed" ? computeClickCohortRatios(clickCohort) : {}),
        submittedReportCohortApprovalRate: reports ? computeReportCohortRatio(reports) : null,
      },
    });

    return NextResponse.json(
      {
        mode: GROWTH_ANALYTICS_MODE,
        rateMode: GROWTH_RATE_MODE,
        rateModeExplanation: GROWTH_RATE_MODE_EXPLANATION,
        attributionExplanation: GROWTH_ATTRIBUTION_EXPLANATION,
        ratioDenominators: GROWTH_RATIO_DENOMINATORS,
        // G4-R2/G4-R5. Every rate names the population it divides, and every one
        // of them is a subset of the set it is drawn from. The two entries that
        // were NOT — a click-denominated event quotient and an approval quotient
        // across two windows — are gone rather than renamed.
        ratioBasis: {
          attributedClickToRegistrationRate: "click_cohort_converted_subset_of_cohort",
          attributedRegistrationToActivationRate: "click_cohort_learners_subset",
          attributedRegistrationToPocketRegistrationRate: "click_cohort_learners_subset",
          attributedRegistrationToDepositRate: "click_cohort_learners_subset",
          attributedPocketRegistrationToDepositRate: "click_cohort_pocket_learners_subset",
          enrollmentRate: "unique_learners_subset_of_registered",
          activationRate: "unique_learners_subset_of_registered",
          pocketRegistrationRate: "unique_learners_subset_of_registered",
          depositRatePerRegistration: "unique_learners_subset_of_registered",
          depositRatePerPocketRegistration: "unique_learners_subset_of_pocket_registered",
          assessmentPassRate: "events_same_population",
          submittedReportCohortApprovalRate: "submission_cohort_approved_subset_of_submitted",
        },
        clickCohort,
        period: serializePeriod(period),
        filters: {
          affiliatePartnerId: filters.affiliatePartnerId ?? null,
          affiliateCampaignId: filters.affiliateCampaignId ?? null,
          trackingLinkId: filters.trackingLinkId ?? null,
        },
        coverage: {
          attributed: block(attributed, "attributed", learnersAttributed, reportCohortAttributed),
          // Null rather than a block of zeroes when a filter is set — see above.
          organic:
            organic === null ? null : block(organic, "organic", learnersOrganic, reportCohortOrganic),
          total: total === null ? null : block(total, "total", learnersTotal, reportCohortTotal),
        },
        // G4-H3/H4. Published at the top level because it is a property of ATA's
        // tracking, not of any one coverage block.
        attributionCoverage: computeAttributionCoverage({
          attributedRegistrations: attributed.ataRegistrations,
          totalRegistrations: (total ?? attributed).ataRegistrations,
        }),
        firstDepositAmount: amounts,
        dataAvailability: buildGrowthAvailability({
          redepositCapability: resolveRedepositCapability(),
          amountAggregationAvailable: amounts.amountAggregationAvailable,
          amountUnavailableReason: amounts.unavailableReason,
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
