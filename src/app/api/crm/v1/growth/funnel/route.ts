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
import { GROWTH_ANALYTICS_MODE } from "@/lib/growth/analytics/sources";
import { loadGrowthCounts, loadLevelFunnel } from "@/lib/growth/analytics/queries";
import {
  GROWTH_ATTRIBUTION_EXPLANATION,
  buildGrowthAvailability,
} from "@/lib/growth/analytics/availability";
import {
  GROWTH_COMMON_KEYS,
  assertGrowthFilterHierarchy,
  parseFunnelMaxLevel,
  parseGrowthFilters,
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

    const window = { start: period.startUtc ?? new Date(0), end: period.endUtc };

    const [counts, levels] = await Promise.all([
      loadGrowthCounts(prisma, window, filters, "attributed"),
      loadLevelFunnel(prisma, window, filters, "attributed", maxLevel),
    ]);

    // Each step states its own denominator, and the accepted exact-decimal
    // helper computes it: `null` — never zero — when that denominator is zero,
    // so "no traffic yet" cannot render as "0% converted".
    const rate = exactRatio;

    const acquisitionSteps = [
      { step: "click", count: counts.clicks, ofStep: null, rate: null, dropOff: null },
      {
        step: "ata_registration",
        count: counts.ataRegistrations,
        ofStep: "click",
        rate: rate(counts.ataRegistrations, counts.clicks),
        dropOff: counts.clicks - counts.ataRegistrations,
      },
      {
        step: "enrollment",
        count: counts.enrollments,
        ofStep: "ata_registration",
        rate: rate(counts.enrollments, counts.ataRegistrations),
        dropOff: counts.ataRegistrations - counts.enrollments,
      },
      {
        step: "academy_activation",
        count: counts.activatedLearners,
        ofStep: "enrollment",
        rate: rate(counts.activatedLearners, counts.enrollments),
        dropOff: counts.enrollments - counts.activatedLearners,
      },
      {
        step: "pocket_registration",
        count: counts.pocketRegistrations,
        ofStep: "academy_activation",
        rate: rate(counts.pocketRegistrations, counts.activatedLearners),
        dropOff: counts.activatedLearners - counts.pocketRegistrations,
      },
      {
        step: "first_deposit",
        count: counts.firstDeposits,
        ofStep: "pocket_registration",
        rate: rate(counts.firstDeposits, counts.pocketRegistrations),
        dropOff: counts.pocketRegistrations - counts.firstDeposits,
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
        acquisitionFunnel: {
          // Stated explicitly so a client cannot assume the previous row is the
          // denominator when a step is filtered out of a chart.
          denominatorModel: "each_step_states_its_own_ofStep",
          steps: acquisitionSteps,
        },
        levelFunnel: {
          // A level absent from this list had NO events in the period. That is
          // deliberately not the same as a level with zero, and the client is
          // told which it is looking at rather than left to guess.
          absentMeans: "no_events_in_period",
          steps: levels.map((level) => ({
            ...level,
            completionRate: rate(level.completed, level.started),
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
