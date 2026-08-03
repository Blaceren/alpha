/**
 * AFD-5D1 — the input the engine reads, and the ONLY place data is loaded.
 *
 * EVERY VALUE COMES FROM AN ACCEPTED AGGREGATE. This module calls exactly the
 * functions the shipped `summary`, `timeseries` and `breakdown` routes call —
 * `loadCounts`, `computeRatios`, `loadAmountAvailability`, `loadBucketCounts`,
 * `loadBreakdown` for event-date mode, and the AFD-5B2A cohort equivalents for
 * cohort mode. It writes no SQL of its own, defines no metric, adds no column
 * and touches no migration.
 *
 * WHY THE INPUT IS A PLAIN, FULLY-MATERIALISED STRUCT. The rules must be
 * synchronous, pure and testable without a database: a rule that could issue a
 * query would be a place where a new metric could be born, and this phase is
 * explicitly not allowed to grow one. Loading happens here, once; reasoning
 * happens in `analysis-rules.ts`, over data that is already fixed.
 */
import type { PrismaClient } from "@prisma/client";
import {
  computeRatios,
  loadAmountAvailability,
  loadBreakdown,
  loadBucketCounts,
  loadCounts,
  earliestEventInstant,
  RATIO_DENOMINATORS,
  type AmountAvailability,
  type BreakdownDimension,
  type BreakdownRow,
  type BucketCounts,
  type PeriodRatios,
} from "@/lib/analytics/affiliate-queries";
import {
  cohortScope,
  computeCohortRates,
  loadCohortAmount,
  loadCohortBreakdown,
  loadCohortBuckets,
  loadCohortCounts,
  loadCohortIntegrity,
  loadCohortMedians,
  COHORT_RATE_DENOMINATORS,
  type CohortAmountAvailability,
  type CohortBreakdownRow,
  type CohortBucket,
  type CohortCounts,
  type CohortIntegrity,
  type CohortMedians,
  type CohortRates,
} from "@/lib/analytics/cohort-queries";
import type { Coverage, AnalyticsFilters, MetricCounts } from "@/lib/analytics/affiliate-sources";
import type { ResolvedCutoff } from "@/lib/analytics/cohort-time";
import {
  buildBuckets,
  countBuckets,
  MAX_BUCKETS,
  AnalyticsPeriodError,
  type BucketGroup,
  type ResolvedPeriod,
} from "@/lib/analytics/periods";
import { isUnfiltered } from "@/lib/analytics/request";

export { RATIO_DENOMINATORS, COHORT_RATE_DENOMINATORS };

/* -------------------------------------------------------- the input shape */

export type EventDateInput = {
  readonly mode: "event_date";
  readonly period: ResolvedPeriod;
  readonly filters: AnalyticsFilters;
  readonly coverage: Coverage;
  readonly filtered: boolean;
  readonly group: BucketGroup;
  readonly dimension: BreakdownDimension;
  /** Period totals for the reported coverage. */
  readonly counts: MetricCounts;
  readonly ratios: PeriodRatios;
  readonly amount: AmountAvailability;
  /** Present only for an unfiltered report, where the split is meaningful. */
  readonly attributedCounts: MetricCounts | null;
  readonly unattributedCounts: MetricCounts | null;
  readonly buckets: readonly BucketCounts[];
  readonly breakdown: readonly BreakdownRow[];
  /** Attributed totals, the denominator every breakdown share is taken over. */
  readonly breakdownTotals: MetricCounts;
};

export type CohortInput = {
  readonly mode: "acquisition_cohort";
  readonly period: ResolvedPeriod;
  readonly cutoff: ResolvedCutoff;
  readonly filters: AnalyticsFilters;
  readonly filtered: boolean;
  readonly group: BucketGroup;
  readonly dimension: BreakdownDimension;
  readonly counts: CohortCounts;
  readonly rates: CohortRates;
  readonly medians: CohortMedians;
  readonly integrity: CohortIntegrity;
  readonly amount: CohortAmountAvailability;
  readonly buckets: readonly CohortBucket[];
  readonly breakdown: readonly CohortBreakdownRow[];
};

export type AnalysisInput = EventDateInput | CohortInput;

/* ------------------------------------------------------------- the loader */

export type AnalysisLoadRequest = {
  readonly period: ResolvedPeriod;
  readonly filters: AnalyticsFilters;
  readonly group: BucketGroup;
  readonly dimension: BreakdownDimension;
};

/**
 * Event-date input.
 *
 * The coverage rule is the shipped one, not a new one: an unfiltered report is
 * `total`, a filtered report is `attributed`, because events belonging to nobody
 * cannot belong to the affiliate that was asked about. The attributed and
 * unattributed slices are additionally loaded ONLY when unfiltered, which is the
 * only case in which the three reconcile.
 */
export async function loadEventDateInput(
  db: PrismaClient,
  request: AnalysisLoadRequest,
): Promise<EventDateInput> {
  const { period, filters, group, dimension } = request;
  const filtered = !isUnfiltered(filters);
  const coverage: Coverage = filtered ? "attributed" : "total";

  // The same all-time handling the timeseries route uses: the series starts at
  // the earliest event actually present, derived from data and never invented.
  const seriesStart =
    period.startUtc === null
      ? ((await earliestEventInstant(db, period, filters, coverage)) ?? undefined)
      : undefined;

  // Refuse before building, exactly as the timeseries route does. A truncated
  // series would make every endpoint comparison below a comparison of the wrong
  // two buckets.
  if (countBuckets(period, group, seriesStart) > MAX_BUCKETS) {
    throw new AnalyticsPeriodError("crm.analytics.bucket_cap_exceeded");
  }
  const timeBuckets = buildBuckets(period, group, seriesStart);

  const [counts, amount, buckets, breakdownMap, breakdownTotals] = await Promise.all([
    loadCounts(db, period, filters, coverage),
    loadAmountAvailability(db, period, filters, coverage),
    loadBucketCounts(db, period, filters, coverage, timeBuckets),
    loadBreakdown(db, period, filters, dimension),
    loadCounts(db, period, filters, "attributed"),
  ]);

  const [attributedCounts, unattributedCounts] = filtered
    ? [null, null]
    : await Promise.all([
        loadCounts(db, period, filters, "attributed"),
        loadCounts(db, period, filters, "unattributed"),
      ]);

  return {
    mode: "event_date",
    period,
    filters,
    coverage,
    filtered,
    group,
    dimension,
    counts,
    ratios: computeRatios(counts),
    amount,
    attributedCounts,
    unattributedCounts,
    buckets,
    breakdown: [...breakdownMap.values()],
    breakdownTotals,
  };
}

/** Acquisition-cohort input, through the AFD-5B2A owners and no others. */
export async function loadCohortInput(
  db: PrismaClient,
  request: AnalysisLoadRequest & { readonly cutoff: ResolvedCutoff },
): Promise<CohortInput> {
  const { period, filters, group, dimension, cutoff } = request;
  const scope = cohortScope(period, cutoff, filters);

  if (countBuckets(period, group) > MAX_BUCKETS) {
    throw new AnalyticsPeriodError("crm.analytics.bucket_cap_exceeded");
  }
  const timeBuckets = buildBuckets(period, group);

  const [counts, medians, integrity, amount, buckets, breakdownMap] = await Promise.all([
    loadCohortCounts(db, scope),
    loadCohortMedians(db, scope),
    loadCohortIntegrity(db, scope),
    loadCohortAmount(db, scope),
    loadCohortBuckets(db, scope, timeBuckets),
    loadCohortBreakdown(db, scope, dimension),
  ]);

  return {
    mode: "acquisition_cohort",
    period,
    cutoff,
    filters,
    filtered: !isUnfiltered(filters),
    group,
    dimension,
    counts,
    rates: computeCohortRates(counts),
    medians,
    integrity,
    amount,
    buckets,
    breakdown: [...breakdownMap.values()],
  };
}
