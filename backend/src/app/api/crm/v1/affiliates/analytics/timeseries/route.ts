import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ANALYTICS_MODE, METRIC_KEYS, RATE_MODE } from "@/lib/analytics/affiliate-sources";
import {
  earliestEventInstant,
  loadAmountAvailability,
  loadBucketCounts,
  loadCounts,
} from "@/lib/analytics/affiliate-queries";
import {
  buildDataAvailability,
  RATE_MODE_EXPLANATION,
  UNIQUE_VISITOR_EXPLANATION,
} from "@/lib/analytics/availability";
import {
  AnalyticsPeriodError,
  buildBuckets,
  countBuckets,
  MAX_BUCKETS,
  resolvePeriod,
} from "@/lib/analytics/periods";
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
  parseGroup,
  parsePeriodInput,
} from "@/lib/analytics/request";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/crm/v1/affiliates/analytics/timeseries
//
// Event-date buckets over one period. Interior zero buckets are present, bucket
// boundaries are exact, and every additive count reconciles with the summary
// total for the same scope.

const KEYS = [
  "preset",
  "startDate",
  "endDate",
  "group",
  "affiliatePartnerId",
  "affiliateCampaignId",
  "affiliateTrackingLinkId",
] as const;

/** Additive metrics sum across buckets; uniqueVisitors deliberately does not. */
const ADDITIVE = METRIC_KEYS.filter((metric) => metric !== "uniqueVisitors");

export async function GET(request: Request) {
  const { requestId, headers } = beginAnalyticsRequest();

  try {
    const { params, timezone, now } = await openAnalyticsRequest(request);
    assertKnownAnalyticsKeys(params, KEYS);

    const filters = parseFilters(params);
    await assertFilterHierarchy(filters);
    const period = resolvePeriod(parsePeriodInput(params), timezone, now);
    const group = parseGroup(params);
    const unfiltered = isUnfiltered(filters);
    const coverage = unfiltered ? "total" : "attributed";

    // All-time has no left edge of its own, so the series starts at the earliest
    // event actually present. Derived from data, never invented — and when there
    // is no data the series is honestly empty.
    const seriesStart =
      period.startUtc === null
        ? ((await earliestEventInstant(prisma, period, filters, coverage)) ?? undefined)
        : undefined;

    // Refuse before building. A truncated series is a chart silently missing its
    // left-hand side, which is worse than an error the caller can act on.
    if (countBuckets(period, group, seriesStart) > MAX_BUCKETS) {
      throw new AnalyticsPeriodError("crm.analytics.bucket_cap_exceeded");
    }

    const buckets = buildBuckets(period, group, seriesStart);

    const [bucketCounts, totals, amounts] = await Promise.all([
      loadBucketCounts(prisma, period, filters, coverage, buckets),
      loadCounts(prisma, period, filters, coverage),
      loadAmountAvailability(prisma, period, filters, coverage),
    ]);

    // Proof, computed and published rather than asserted in a comment: every
    // additive metric's bucket sum must equal the independently-queried period
    // total. A mismatch means the buckets do not partition the period.
    const reconciliation = ADDITIVE.map((metric) => {
      const bucketSum = bucketCounts.reduce((sum, bucket) => sum + bucket.counts[metric], 0);
      return { metric, bucketSum, periodTotal: totals[metric], matches: bucketSum === totals[metric] };
    });

    return NextResponse.json(
      {
        mode: ANALYTICS_MODE,
        rateMode: RATE_MODE,
        rateModeExplanation: RATE_MODE_EXPLANATION,
        period: serializePeriod(period),
        group,
        coverage,
        bucketCount: buckets.length,
        bucketCap: MAX_BUCKETS,
        buckets: buckets.map((bucket, index) => ({
          localLabel: bucket.localLabel,
          startUtc: bucket.startUtc.toISOString(),
          endUtc: bucket.endUtc.toISOString(),
          metrics: {
            ...bucketCounts[index]!.counts,
            // Renamed inside the bucket so it can never be mistaken for a slice
            // of the period figure that it does not sum to.
            bucketUniqueVisitors: bucketCounts[index]!.counts.uniqueVisitors,
          },
        })),
        totals,
        // The two unique-visitor numbers are reported side by side, with the
        // reason they differ, so nobody has to discover it from a mismatch.
        periodUniqueVisitors: totals.uniqueVisitors,
        summedBucketUniqueVisitors: bucketCounts.reduce(
          (sum, bucket) => sum + bucket.counts.uniqueVisitors,
          0,
        ),
        uniqueVisitorExplanation: UNIQUE_VISITOR_EXPLANATION,
        reconciliation: {
          additiveMetricsMatch: reconciliation.every((entry) => entry.matches),
          details: reconciliation,
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
