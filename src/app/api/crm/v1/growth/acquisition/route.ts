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
import { AffiliateInputError } from "@/lib/crm/affiliates";
import { GROWTH_ANALYTICS_MODE } from "@/lib/growth/analytics/sources";
import { loadAcquisitionBreakdown } from "@/lib/growth/analytics/queries";
import {
  GROWTH_ATTRIBUTION_EXPLANATION,
  buildGrowthAvailability,
} from "@/lib/growth/analytics/availability";
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

    const rows = await loadAcquisitionBreakdown(prisma, window, dimension, limit);

    // The accepted exact-decimal helper, not a float quotient. Null — never
    // zero — when the denominator is zero.
    const rate = exactRatio;

    return NextResponse.json(
      {
        mode: GROWTH_ANALYTICS_MODE,
        attributionExplanation: GROWTH_ATTRIBUTION_EXPLANATION,
        period: serializePeriod(period),
        dimension,
        limit,
        // Said out loud so nobody has to infer it from the ordering.
        rankingPolicy: "none_ordered_by_id",
        qualityScorePolicy: "not_computed_by_design",
        rows: rows.map((row) => ({
          ...row,
          ataRegistrationRate: rate(row.ataRegistrations, row.clicks),
          activationRate: rate(row.activatedLearners, row.ataRegistrations),
          pocketRegistrationRate: rate(row.pocketRegistrations, row.ataRegistrations),
          depositRatePerRegistration: rate(row.firstDeposits, row.ataRegistrations),
          depositRatePerPocketRegistration: rate(row.firstDeposits, row.pocketRegistrations),
        })),
        dataAvailability: buildGrowthAvailability({
          amountAggregationAvailable: false,
          amountUnavailableReason: "per_row_amounts_not_published_on_this_surface",
        }),
        generatedAt: now.toISOString(),
      },
      { headers },
    );
  } catch (error) {
    return analyticsErrorResponse(error, requestId, headers);
  }
}
