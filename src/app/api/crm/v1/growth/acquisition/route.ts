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
import { AffiliateInputError } from "@/lib/crm/affiliates";
import {
  GROWTH_ANALYTICS_MODE,
  computeClickCohortRatios,
} from "@/lib/growth/analytics/sources";
import {
  loadAcquisitionBreakdown,
  loadClickCohortFunnel,
  loadRegistrationOriginCoverage,
} from "@/lib/growth/analytics/queries";
import {
  GROWTH_ATTRIBUTION_EXPLANATION,
  buildGrowthAvailability,
} from "@/lib/growth/analytics/availability";
import { resolveRedepositCapability } from "@/lib/growth/ingress-config";
import {
  GROWTH_COMMON_KEYS,
  parseGrowthLimit,
} from "@/lib/growth/analytics/request";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const KEYS = [...GROWTH_COMMON_KEYS, "dimension", "limit"] as const;

/**
 * The dimensions this surface may group by.
 *
 * AN ALLOWLIST INDEXING A COMPILE-TIME UNION, not a column name. There is no
 * path from this query parameter to SQL, to an ORDER BY, or to a table — §58
 * requires exactly that, and a `dimension` that reached a raw fragment would be
 * the most obvious injection surface in the whole Growth API.
 */
const DIMENSIONS = ["affiliatePartner", "affiliateCampaign", "trackingLink"] as const;
type Dimension = (typeof DIMENSIONS)[number];

/**
 * GET /api/crm/v1/growth/acquisition
 *
 * The CMO surface: compare acquisition sources beyond the cheap front-end
 * registration, by putting each source's downstream behaviour on the same row.
 *
 * NO SCORE, NO RANKING, NO RECOMMENDATION. §35 is explicit that this phase must
 * not invent a "traffic quality" number, and it is right to be: a single score
 * would bury the trade-off it is supposed to expose, and its weights would be
 * this file's opinion presented as the platform's measurement. The rows carry
 * observable counts and the reader draws the conclusion.
 *
 * ORDERED BY ID, DELIBERATELY. Sorting by deposits would be a ranking by another
 * name, and would make the surface's default view an implicit recommendation.
 */
export async function GET(request: Request) {
  const { requestId, headers } = beginAnalyticsRequest();

  try {
    const { params, timezone, now } = await openAnalyticsRequest(request);
    assertKnownAnalyticsKeys(params, KEYS);

    const rawDimension = params.get("dimension") ?? "affiliateCampaign";
    if (!DIMENSIONS.includes(rawDimension as Dimension)) {
      throw new AffiliateInputError("crm.analytics.dimension_invalid");
    }
    const dimension = rawDimension as Dimension;

    const period = resolvePeriod(parsePeriodInput(params), timezone, now);
    const limit = parseGrowthLimit(params);
    const window = { start: period.startUtc ?? new Date(0), end: period.endUtc };

    // The unfiltered cohort across every source, computed even when no source
    // row exists.
    //
    // TWO REASONS, AND THE SECOND IS THE IMPORTANT ONE. It gives a reader the
    // denominator the rows are a breakdown OF — a table of three campaigns says
    // nothing about how much tracked traffic they are between them. And it makes
    // this route DEPEND ON THE LEDGER: with no affiliate partner configured,
    // `loadAcquisitionBreakdown` returns an empty list without ever touching
    // `GrowthEvent`, so on a database that predates migration 47 this surface
    // used to answer 200 with `rows: []` — "no acquisition sources" — while its
    // four siblings correctly failed loudly. An empty answer and an impossible
    // answer must not look the same.
    const [breakdown, totals, registrationOriginCoverage] = await Promise.all([
      loadAcquisitionBreakdown(prisma, window, dimension, limit),
      loadClickCohortFunnel(prisma, window, {}),
      // G4-R12. See the overview route.
      loadRegistrationOriginCoverage(prisma),
    ]);

    return NextResponse.json(
      {
        mode: GROWTH_ANALYTICS_MODE,
        attributionExplanation: GROWTH_ATTRIBUTION_EXPLANATION,
        period: serializePeriod(period),
        dimension,
        limit,
        // Said out loud so nobody has to infer it from the ordering.
        rankingPolicy: "none_ordered_by_id",
        // G4-M9. The rows are the first `limit` members by id. Whether that is
        // ALL of them was previously unknowable from the payload, so an
        // operator could not tell twenty-five campaigns from the oldest
        // twenty-five of two hundred — and the oldest can all be dormant.
        totalDimensionMembers: breakdown.totalMembers,
        truncated: breakdown.truncated,
        qualityScorePolicy: "not_computed_by_design",
        // G4-R2. THE CONTRACT THIS SURFACE ANSWERS, stated in the payload rather
        // than left to a reader's assumption — because the assumption is exactly
        // what was wrong twice. Every count and every rate on a row describes ONE
        // set: the qualified clicks this source produced in the period. Downstream
        // state is the cohort's state today, not a second window's event count.
        metricClass: "attributed_click_cohort",
        cohortAnchor: "qualified_clicks_occurred_in_period",
        downstreamObservation: "cohort_state_to_date_not_windowed_events",
        rateBasis: {
          attributedClickToRegistrationRate: "converted_clicks_subset_of_cohort_clicks",
          attributedRegistrationToActivationRate: "subset_of_cohort_registered_learners",
          attributedRegistrationToPocketRegistrationRate: "subset_of_cohort_registered_learners",
          attributedRegistrationToDepositRate: "subset_of_cohort_registered_learners",
          attributedPocketRegistrationToDepositRate:
            "subset_of_cohort_pocket_registered_learners",
        },
        totals: { ...totals, ...computeClickCohortRatios(totals) },
        rows: breakdown.rows.map((row) => ({
          ...row,
          ...computeClickCohortRatios(row),
        })),
        dataAvailability: buildGrowthAvailability({
          redepositCapability: resolveRedepositCapability(),
          amountAggregationAvailable: false,
          amountUnavailableReason: "per_row_amounts_not_published_on_this_surface",
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
