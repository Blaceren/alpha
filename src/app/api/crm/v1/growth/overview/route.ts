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
  computeGrowthRatios,
  type GrowthMetricCounts,
} from "@/lib/growth/analytics/sources";
import {
  loadFirstDepositAmounts,
  loadGrowthCounts,
} from "@/lib/growth/analytics/queries";
import {
  GROWTH_ATTRIBUTION_EXPLANATION,
  GROWTH_RATE_MODE_EXPLANATION,
  buildGrowthAvailability,
} from "@/lib/growth/analytics/availability";
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
    const [attributed, unattributed, total, amounts] = await Promise.all([
      loadGrowthCounts(prisma, window, filters, "attributed"),
      unfiltered
        ? loadGrowthCounts(prisma, window, filters, "unattributed")
        : Promise.resolve(null),
      unfiltered ? loadGrowthCounts(prisma, window, filters, "total") : Promise.resolve(null),
      loadFirstDepositAmounts(prisma, window, filters, unfiltered ? "total" : "attributed"),
    ]);

    const block = (counts: GrowthMetricCounts) => ({
      ...counts,
      ratios: computeGrowthRatios(counts),
    });

    return NextResponse.json(
      {
        mode: GROWTH_ANALYTICS_MODE,
        rateMode: GROWTH_RATE_MODE,
        rateModeExplanation: GROWTH_RATE_MODE_EXPLANATION,
        attributionExplanation: GROWTH_ATTRIBUTION_EXPLANATION,
        ratioDenominators: GROWTH_RATIO_DENOMINATORS,
        period: serializePeriod(period),
        filters: {
          affiliatePartnerId: filters.affiliatePartnerId ?? null,
          affiliateCampaignId: filters.affiliateCampaignId ?? null,
          trackingLinkId: filters.trackingLinkId ?? null,
        },
        coverage: {
          attributed: block(attributed),
          // Null rather than a block of zeroes when a filter is set — see above.
          unattributed: unattributed === null ? null : block(unattributed),
          total: total === null ? null : block(total),
        },
        firstDepositAmount: amounts,
        dataAvailability: buildGrowthAvailability({
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
