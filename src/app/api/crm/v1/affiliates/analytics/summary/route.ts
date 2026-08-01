import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ANALYTICS_MODE,
  RATE_MODE,
  type MetricCounts,
} from "@/lib/analytics/affiliate-sources";
import {
  computeRatios,
  loadAmountAvailability,
  loadCounts,
  RATIO_DENOMINATORS,
} from "@/lib/analytics/affiliate-queries";
import {
  buildDataAvailability,
  RATE_MODE_EXPLANATION,
} from "@/lib/analytics/availability";
import { resolvePeriod } from "@/lib/analytics/periods";
import {
  analyticsErrorResponse,
  beginAnalyticsRequest,
  openAnalyticsRequest,
  serializePeriod,
} from "@/lib/analytics/routes";
import {
  assertFilterHierarchy,
  assertKnownAnalyticsKeys,
  isUnfiltered,
  parseFilters,
  parsePeriodInput,
} from "@/lib/analytics/request";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/crm/v1/affiliates/analytics/summary
//
// Event-date totals for one period, plus the funnel ratios and the honest
// statement of what this deployment can and cannot measure. No series, no lead
// rows, no raw identifiers.

const KEYS = [
  "preset",
  "startDate",
  "endDate",
  "affiliatePartnerId",
  "affiliateCampaignId",
  "affiliateTrackingLinkId",
] as const;

function metricsBlock(counts: MetricCounts) {
  return {
    ...counts,
    ratios: computeRatios(counts),
  };
}

export async function GET(request: Request) {
  const { requestId, headers } = beginAnalyticsRequest();

  try {
    const { params, timezone, now } = await openAnalyticsRequest(request);
    assertKnownAnalyticsKeys(params, KEYS);

    const filters = parseFilters(params);
    await assertFilterHierarchy(filters);
    const period = resolvePeriod(parsePeriodInput(params), timezone, now);

    const unfiltered = isUnfiltered(filters);

    // A filtered report has no unattributed slice to show: events belonging to
    // nobody cannot belong to the affiliate that was asked about. Computing it
    // anyway would publish a number that answers a question nobody posed.
    const [attributed, unattributed, total, amounts] = await Promise.all([
      loadCounts(prisma, period, filters, "attributed"),
      unfiltered ? loadCounts(prisma, period, filters, "unattributed") : Promise.resolve(null),
      unfiltered ? loadCounts(prisma, period, filters, "total") : Promise.resolve(null),
      loadAmountAvailability(prisma, period, filters, unfiltered ? "total" : "attributed"),
    ]);

    return NextResponse.json(
      {
        mode: ANALYTICS_MODE,
        rateMode: RATE_MODE,
        rateModeExplanation: RATE_MODE_EXPLANATION,
        ratioDenominators: RATIO_DENOMINATORS,
        period: serializePeriod(period),
        filters: {
          affiliatePartnerId:
            filters.affiliatePartnerId === undefined ? null : String(filters.affiliatePartnerId),
          affiliateCampaignId:
            filters.affiliateCampaignId === undefined ? null : String(filters.affiliateCampaignId),
          affiliateTrackingLinkId:
            filters.affiliateTrackingLinkId === undefined
              ? null
              : String(filters.affiliateTrackingLinkId),
        },
        coverage: {
          attributed: metricsBlock(attributed),
          // Null rather than a block of zeroes when a filter is set — see above.
          unattributed: unattributed === null ? null : metricsBlock(unattributed),
          total: total === null ? null : metricsBlock(total),
        },
        firstDepositAmount: amounts,
        dataAvailability: buildDataAvailability({
          amountAggregationAvailable: amounts.amountAggregationAvailable,
          amountUnavailableReason: amounts.unavailableReason,
        }),
        generatedAt: now.toISOString(),
      },
      { headers },
    );
  } catch (error) {
    return analyticsErrorResponse(error, requestId, headers);
  }
}
