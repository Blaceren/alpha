import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  COHORT_RATE_DENOMINATORS,
  computeCohortRates,
  cohortScope,
  loadCohortBuckets,
  loadCohortCounts,
  loadCohortMedians,
} from "@/lib/analytics/cohort-queries";
import {
  buildCohortAvailability,
  COHORT_MODE_EXPLANATION,
  COHORT_VERSUS_EVENT_DATE_EXPLANATION,
} from "@/lib/analytics/cohort-availability";
import {
  buildBucketFollowupMetadata,
  buildFollowupMetadata,
} from "@/lib/analytics/cohort-time";
import {
  COHORT_BASE_KEYS,
  COHORT_IDENTITY,
  resolveCohortCutoff,
  serializeCutoff,
  serializeFilters,
} from "@/lib/analytics/cohort-routes";
import { AnalyticsPeriodError, buildBuckets, countBuckets, MAX_BUCKETS } from "@/lib/analytics/periods";
import {
  analyticsErrorResponse,
  beginAnalyticsRequest,
  openAnalyticsRequest,
  serializePeriod,
} from "@/lib/analytics/routes";
import {
  assertFilterHierarchy,
  assertKnownAnalyticsKeys,
  parseFilters,
  parseGroup,
  parsePeriodInput,
} from "@/lib/analytics/request";
import { resolvePeriod } from "@/lib/analytics/periods";
import { earliestCohortClick, loadCohortAmount } from "@/lib/analytics/cohort-queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/crm/v1/affiliates/analytics/cohorts/timeseries
//
// One row per ACQUISITION bucket — day, week or month of the selected click —
// each observed through the SAME report cutoff, so the buckets are comparable.

const KEYS = [...COHORT_BASE_KEYS, "group"] as const;

export async function GET(request: Request) {
  const { requestId, headers } = beginAnalyticsRequest();

  try {
    const { params, timezone, now } = await openAnalyticsRequest(request);
    assertKnownAnalyticsKeys(params, KEYS);

    const filters = parseFilters(params);
    await assertFilterHierarchy(filters);
    const period = resolvePeriod(parsePeriodInput(params), timezone, now);
    const cutoff = resolveCohortCutoff(params, period, timezone, now);
    const group = parseGroup(params);
    const scope = cohortScope(period, cutoff, filters);

    // `all_time` has no left edge of its own, so the series starts at the
    // earliest selected click that the filters actually admit. DERIVED FROM
    // DATA, never invented: with no cohort at all the series is honestly empty.
    const seriesStart =
      period.startUtc === null ? await earliestCohortClick(prisma, scope) : undefined;

    // Refused, never truncated: a silently shortened series is a chart missing
    // its left-hand side with nothing on screen saying so.
    if (countBuckets(period, group, seriesStart ?? undefined) > MAX_BUCKETS) {
      throw new AnalyticsPeriodError("crm.analytics.bucket_cap_exceeded");
    }
    const buckets = buildBuckets(period, group, seriesStart ?? undefined);

    const [series, totals, totalMedians, amount] = await Promise.all([
      loadCohortBuckets(prisma, scope, buckets),
      loadCohortCounts(prisma, scope),
      loadCohortMedians(prisma, scope),
      loadCohortAmount(prisma, scope),
    ]);

    return NextResponse.json(
      {
        ...COHORT_IDENTITY,
        cohortModeExplanation: COHORT_MODE_EXPLANATION,
        cohortVersusEventDate: COHORT_VERSUS_EVENT_DATE_EXPLANATION,
        rateDenominators: COHORT_RATE_DENOMINATORS,
        cohortPeriod: serializePeriod(period),
        reportCutoff: serializeCutoff(cutoff),
        filters: serializeFilters(filters),
        group,
        bucketCap: MAX_BUCKETS,
        buckets: series.map((bucket, index) => {
          const boundaries = buckets[index];
          return {
            localLabel: bucket.localLabel,
            acquisitionStartUtc: boundaries ? boundaries.startUtc.toISOString() : null,
            acquisitionEndUtc: boundaries ? boundaries.endUtc.toISOString() : null,
            metrics: bucket.counts,
            // Recomputed from THIS bucket's own counts. Bucket rates are never
            // averaged into the total, and the total is never spread back.
            rates: computeCohortRates(bucket.counts),
            medianLags: bucket.medians,
            followup: boundaries
              ? buildBucketFollowupMetadata(boundaries, timezone, cutoff)
              : null,
          };
        }),
        // The whole-period figures the buckets partition. COUNTS reconcile
        // additively; RATES are recomputed from the total counts and MEDIANS are
        // computed over the whole cohort — a median of medians is not a median.
        totals: {
          metrics: totals,
          rates: computeCohortRates(totals),
          medianLags: totalMedians,
          followup: buildFollowupMetadata(period, cutoff),
        },
        reconciliation: {
          countsAreAdditive: true,
          ratesAreAdditive: false,
          mediansAreAdditive: false,
          explanation:
            "Bucket cohortLearners, pocketRegisteredLearners and " +
            "firstDepositLearners sum to the totals. Rates are recomputed from " +
            "the total counts rather than averaged across buckets, and medians " +
            "are computed over the whole cohort because a median of medians is " +
            "not a median.",
        },
        // The whole-period deposit money, under the same currency rules as the
        // summary — reported rather than fudged, so the availability block means
        // the same thing on every route.
        firstDepositAmount: amount,
        dataAvailability: buildCohortAvailability({
          amountAggregationAvailable: amount.amountAggregationAvailable,
          amountUnavailableReason: amount.unavailableReason,
        }),
        generatedAt: now.toISOString(),
      },
      { headers },
    );
  } catch (error) {
    return analyticsErrorResponse(error, requestId, headers);
  }
}
