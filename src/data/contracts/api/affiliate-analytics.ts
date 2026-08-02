/**
 * AFD-5C1 — runtime contracts for the affiliate analytics API.
 *
 * These mirror the accepted backend DTOs exactly (AFD-5B1 event-date, AFD-5B2A
 * acquisition cohort). Every object is `.strict()`, for the reason AFD-5A's
 * contracts are: a field the backend starts sending later must fail parsing
 * HERE and stop the page rendering, rather than quietly appearing in the UI.
 *
 * TWO RULES THIS FILE ENFORCES STRUCTURALLY, NOT BY CONVENTION:
 *
 *   1. EVERY RATIO IS `string | null`, NEVER `number`. The backend computes
 *      exact decimal strings and returns `null` on a zero denominator. Parsing
 *      into a number would make `null` and `0` interchangeable at the first
 *      arithmetic operation, and "недостаточно данных" would silently become
 *      "0 %". Nothing in the analytics UI ever converts one of these to a
 *      number for display.
 *
 *   2. AMOUNT AND AVAILABILITY ARE DISCRIMINATED UNIONS. A first-deposit total
 *      exists only on the branch where `amountAggregationAvailable` is `true`,
 *      so there is no reachable code path that renders an amount without a
 *      currency. An unavailable capability carries its reason and has no value
 *      field at all — it cannot be rendered as a zero because it has no zero.
 *
 * WHAT IS DELIBERATELY ABSENT, and therefore rejected by `.strict()` if the
 * backend ever sends it here: learner email, learner name, external affiliate
 * click ids, ataClickIds, anonymous visitor ids, Pocket click ids, Pocket player
 * ids, callback queries, raw IPs, raw User-Agents, cookies, current balance and
 * every lead-level row.
 */
import { z } from "zod";

/* ------------------------------------------------------------ error envelope */

/** The backend's closed `{code, messageKey, requestId}` envelope. */
export const analyticsErrorSchema = z
  .object({
    code: z.string().min(1),
    messageKey: z.string().min(1),
    requestId: z.string().min(1).optional(),
  })
  .strict();

/* ------------------------------------------------------------------ periods */

export const datePresetSchema = z.enum([
  "today",
  "yesterday",
  "current_week",
  "previous_week",
  "last_7_days",
  "last_30_days",
  "current_month",
  "previous_month",
  "custom",
  "all_time",
]);
export type DatePreset = z.infer<typeof datePresetSchema>;

export const bucketGroupSchema = z.enum(["day", "week", "month"]);
export type BucketGroup = z.infer<typeof bucketGroupSchema>;

export const breakdownDimensionSchema = z.enum(["affiliate", "campaign", "tracking_link"]);
export type BreakdownDimension = z.infer<typeof breakdownDimensionSchema>;

/**
 * The resolved reporting interval, as the backend computed it.
 *
 * `startUtc`/`startLocal` are null ONLY for `all_time`. `weekStart` and
 * `intervalConvention` are pinned to single literals: they are contract facts
 * the UI displays, and a backend that changed either would be a semantic change
 * this parse must catch rather than render.
 */
export const resolvedPeriodSchema = z
  .object({
    resolvedPreset: datePresetSchema,
    timezone: z.string().min(1),
    weekStart: z.literal("monday"),
    startUtc: z.string().datetime().nullable(),
    endUtc: z.string().datetime(),
    startLocal: z.string().min(1).nullable(),
    endLocal: z.string().min(1),
    intervalConvention: z.literal("start_inclusive_end_exclusive"),
  })
  .strict();
export type ResolvedPeriod = z.infer<typeof resolvedPeriodSchema>;

/** Echoed filters. Strings, so a JavaScript client cannot lose id precision. */
export const analyticsFiltersSchema = z
  .object({
    affiliatePartnerId: z.string().min(1).nullable(),
    affiliateCampaignId: z.string().min(1).nullable(),
    affiliateTrackingLinkId: z.string().min(1).nullable(),
  })
  .strict();

/* ------------------------------------------------------------- availability */

/**
 * One capability's availability.
 *
 * The union is the point: the unavailable branch has a `reason` and no value,
 * so an unavailable capability has nothing a chart could plot as zero.
 */
export const availabilityStateSchema = z.union([
  z.object({ available: z.literal(true) }).strict(),
  z.object({ available: z.literal(false), reason: z.string().min(1) }).strict(),
]);
export type AvailabilityState = z.infer<typeof availabilityStateSchema>;

export const dataAvailabilitySchema = z
  .object({
    trafficClicks: availabilityStateSchema,
    academyRegistrations: availabilityStateSchema,
    pocketRegistrations: availabilityStateSchema,
    firstDeposits: availabilityStateSchema,
    firstDepositAmountAggregation: availabilityStateSchema,
    redeposits: availabilityStateSchema,
    currentBalance: availabilityStateSchema,
    educationQuality: availabilityStateSchema,
    acquisitionCohortMode: availabilityStateSchema,
    leadDrilldown: availabilityStateSchema,
  })
  .strict();
export type DataAvailability = z.infer<typeof dataAvailabilitySchema>;

export const cohortDataAvailabilitySchema = z
  .object({
    registeredAcquisitionCohort: availabilityStateSchema,
    pocketRegistration: availabilityStateSchema,
    firstDeposit: availabilityStateSchema,
    firstDepositAmountAggregation: availabilityStateSchema,
    anonymousVisitorToRegistrationCohortRate: availabilityStateSchema,
    unattributedAcquisitionCohort: availabilityStateSchema,
    directTrafficCohort: availabilityStateSchema,
    educationQuality: availabilityStateSchema,
    redeposits: availabilityStateSchema,
    currentBalance: availabilityStateSchema,
    leadDrilldown: availabilityStateSchema,
    maturityScoring: availabilityStateSchema,
    forecasting: availabilityStateSchema,
  })
  .strict();
export type CohortDataAvailability = z.infer<typeof cohortDataAvailabilitySchema>;

/* ----------------------------------------------------------- first deposits */

/**
 * First-deposit money.
 *
 * A total and a currency exist ONLY on the available branch. There is no
 * reachable shape carrying an amount without a currency code, so the UI cannot
 * render a bare number, cannot assume USD and cannot sum across currencies —
 * those are not decisions the display layer is trusted to get right, they are
 * shapes it cannot express.
 */
export const amountAvailabilitySchema = z.union([
  z
    .object({
      amountAggregationAvailable: z.literal(true),
      amountTotal: z.string().min(1),
      currencyCode: z.string().min(1),
      unavailableReason: z.null(),
    })
    .strict(),
  z
    .object({
      amountAggregationAvailable: z.literal(false),
      amountTotal: z.null(),
      currencyCode: z.null(),
      unavailableReason: z.enum(["currency_unspecified_or_mixed", "no_confirmed_first_deposits"]),
    })
    .strict(),
]);
export type AmountAvailability = z.infer<typeof amountAvailabilitySchema>;

/* --------------------------------------------------------- filter metadata */

const affiliateStatusSchema = z.enum(["active", "paused", "archived"]);
const linkStatusSchema = z.enum(["draft", "active", "paused", "archived"]);
const availabilityLabelSchema = z.enum(["available", "paused", "archived"]);

export const filterPartnerSchema = z
  .object({
    id: z.string().min(1),
    code: z.string().min(1),
    displayName: z.string().min(1),
    status: affiliateStatusSchema,
    archived: z.boolean(),
  })
  .strict();

export const filterCampaignSchema = z
  .object({
    id: z.string().min(1),
    affiliatePartnerId: z.string().min(1),
    code: z.string().min(1),
    displayName: z.string().min(1),
    status: affiliateStatusSchema,
    archived: z.boolean(),
  })
  .strict();

export const filterTrackingLinkSchema = z
  .object({
    id: z.string().min(1),
    affiliatePartnerId: z.string().min(1),
    affiliateCampaignId: z.string().min(1).nullable(),
    publicCode: z.string().min(1),
    displayName: z.string().min(1),
    status: linkStatusSchema,
    availability: availabilityLabelSchema,
    archived: z.boolean(),
  })
  .strict();

export const analyticsFilterOptionsSchema = z
  .object({
    affiliatePartners: z.array(filterPartnerSchema),
    affiliateCampaigns: z.array(filterCampaignSchema),
    affiliateTrackingLinks: z.array(filterTrackingLinkSchema),
  })
  .strict();

export type AnalyticsFilterOptions = z.infer<typeof analyticsFilterOptionsSchema>;
export type FilterPartner = z.infer<typeof filterPartnerSchema>;
export type FilterCampaign = z.infer<typeof filterCampaignSchema>;
export type FilterTrackingLink = z.infer<typeof filterTrackingLinkSchema>;

/* ------------------------------------------------- event-date metric blocks */

export const metricCountsSchema = z
  .object({
    rawClicks: z.number().int().nonnegative(),
    qualifiedClicks: z.number().int().nonnegative(),
    prefetchClicks: z.number().int().nonnegative(),
    authenticatedUserClicks: z.number().int().nonnegative(),
    uniqueVisitors: z.number().int().nonnegative(),
    academyRegistrations: z.number().int().nonnegative(),
    pocketRegistrations: z.number().int().nonnegative(),
    confirmedFirstDeposits: z.number().int().nonnegative(),
    pendingIdentityDeposits: z.number().int().nonnegative(),
    conflictingDeposits: z.number().int().nonnegative(),
  })
  .strict();
export type MetricCounts = z.infer<typeof metricCountsSchema>;

/** Exact decimal strings or null. Never parsed into a number — see the header. */
export const periodRatiosSchema = z
  .object({
    qualifiedClickToAcademyRegistrationRate: z.string().nullable(),
    academyRegistrationToPocketRegistrationRate: z.string().nullable(),
    pocketRegistrationToFirstDepositRate: z.string().nullable(),
    qualifiedClickToPocketRegistrationRate: z.string().nullable(),
    qualifiedClickToFirstDepositRate: z.string().nullable(),
  })
  .strict();
export type PeriodRatios = z.infer<typeof periodRatiosSchema>;

export const metricsBlockSchema = metricCountsSchema.extend({ ratios: periodRatiosSchema }).strict();
export type MetricsBlock = z.infer<typeof metricsBlockSchema>;

const ratioDenominatorsSchema = z
  .object({
    qualifiedClickToAcademyRegistrationRate: z.string().min(1),
    academyRegistrationToPocketRegistrationRate: z.string().min(1),
    pocketRegistrationToFirstDepositRate: z.string().min(1),
    qualifiedClickToPocketRegistrationRate: z.string().min(1),
    qualifiedClickToFirstDepositRate: z.string().min(1),
  })
  .strict();

/* ------------------------------------------------------ event-date summary */

export const eventDateSummarySchema = z
  .object({
    mode: z.literal("event_date"),
    rateMode: z.literal("period_event_ratio"),
    rateModeExplanation: z.string().min(1),
    ratioDenominators: ratioDenominatorsSchema,
    period: resolvedPeriodSchema,
    filters: analyticsFiltersSchema,
    coverage: z
      .object({
        attributed: metricsBlockSchema,
        // Null — not a block of zeroes — when a filter is set. Events belonging
        // to nobody cannot belong to the affiliate that was asked about.
        unattributed: metricsBlockSchema.nullable(),
        total: metricsBlockSchema.nullable(),
      })
      .strict(),
    firstDepositAmount: amountAvailabilitySchema,
    dataAvailability: dataAvailabilitySchema,
    generatedAt: z.string().datetime(),
  })
  .strict();
export type EventDateSummary = z.infer<typeof eventDateSummarySchema>;

/* --------------------------------------------------- event-date time series */

/**
 * One bucket. `bucketUniqueVisitors` is the backend's deliberate rename of the
 * per-bucket distinct count, so it can never be mistaken for a slice of the
 * period figure it does not sum to.
 */
export const timeseriesBucketSchema = z
  .object({
    localLabel: z.string().min(1),
    startUtc: z.string().datetime(),
    endUtc: z.string().datetime(),
    metrics: metricCountsSchema.extend({
      bucketUniqueVisitors: z.number().int().nonnegative(),
    }).strict(),
  })
  .strict();
export type TimeseriesBucket = z.infer<typeof timeseriesBucketSchema>;

export const eventDateTimeseriesSchema = z
  .object({
    mode: z.literal("event_date"),
    rateMode: z.literal("period_event_ratio"),
    rateModeExplanation: z.string().min(1),
    period: resolvedPeriodSchema,
    group: bucketGroupSchema,
    coverage: z.enum(["attributed", "unattributed", "total"]),
    bucketCount: z.number().int().nonnegative(),
    bucketCap: z.number().int().positive(),
    buckets: z.array(timeseriesBucketSchema),
    totals: metricCountsSchema,
    periodUniqueVisitors: z.number().int().nonnegative(),
    summedBucketUniqueVisitors: z.number().int().nonnegative(),
    uniqueVisitorExplanation: z.string().min(1),
    reconciliation: z
      .object({
        additiveMetricsMatch: z.boolean(),
        details: z.array(
          z
            .object({
              metric: z.string().min(1),
              bucketSum: z.number().int().nonnegative(),
              periodTotal: z.number().int().nonnegative(),
              matches: z.boolean(),
            })
            .strict(),
        ),
      })
      .strict(),
    firstDepositAmount: amountAvailabilitySchema,
    dataAvailability: dataAvailabilitySchema,
    generatedAt: z.string().datetime(),
  })
  .strict();
export type EventDateTimeseries = z.infer<typeof eventDateTimeseriesSchema>;

/* ----------------------------------------------------- event-date breakdown */

export const breakdownRowSchema = z
  .object({
    id: z.string().min(1),
    code: z.string().min(1).nullable(),
    displayName: z.string().min(1).nullable(),
    status: z.string().min(1).nullable(),
    availability: z.string().min(1).nullable(),
    archived: z.boolean(),
    affiliatePartnerId: z.string().min(1).nullable(),
    affiliateCampaignId: z.string().min(1).nullable(),
    metrics: metricCountsSchema,
    ratios: periodRatiosSchema,
    firstDepositAmount: amountAvailabilitySchema,
    lastActivityAt: z.string().datetime().nullable(),
  })
  .strict();
export type BreakdownRow = z.infer<typeof breakdownRowSchema>;

export const eventDateBreakdownSchema = z
  .object({
    mode: z.literal("event_date"),
    rateMode: z.literal("period_event_ratio"),
    rateModeExplanation: z.string().min(1),
    ratioDenominators: ratioDenominatorsSchema,
    period: resolvedPeriodSchema,
    dimension: breakdownDimensionSchema,
    includeZeroActivity: z.boolean(),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    rows: z.array(breakdownRowSchema),
    // The attributed scope the rows partition. The UI displays THIS as the
    // total and never adds up the visible page.
    attributedTotals: metricCountsSchema,
    firstDepositAmount: amountAvailabilitySchema,
    dataAvailability: dataAvailabilitySchema,
    generatedAt: z.string().datetime(),
  })
  .strict();
export type EventDateBreakdown = z.infer<typeof eventDateBreakdownSchema>;

/* ------------------------------------------------------------ cohort blocks */

export const cohortCountsSchema = z
  .object({
    cohortLearners: z.number().int().nonnegative(),
    pocketRegisteredLearners: z.number().int().nonnegative(),
    firstDepositLearners: z.number().int().nonnegative(),
  })
  .strict();
export type CohortCounts = z.infer<typeof cohortCountsSchema>;

export const cohortRatesSchema = z
  .object({
    pocketRegistrationRate: z.string().nullable(),
    firstDepositRate: z.string().nullable(),
    pocketToFirstDepositRate: z.string().nullable(),
  })
  .strict();
export type CohortRates = z.infer<typeof cohortRatesSchema>;

/**
 * One median lag.
 *
 * `medianSeconds` is an exact decimal string with at most one fractional digit
 * (`.0` or `.5` — the median of an even population of whole seconds). It stays
 * a string end to end: parsing `"1.5"` into a float and re-rendering it is
 * exactly the lossy round trip the backend went to some trouble to avoid.
 */
export const medianLagSchema = z
  .object({
    medianSeconds: z.string().nullable(),
    sampleSize: z.number().int().nonnegative(),
    negativeDurationCount: z.number().int().nonnegative(),
  })
  .strict();
export type MedianLag = z.infer<typeof medianLagSchema>;

export const cohortMediansSchema = z
  .object({
    selectedClickToAcademyRegistration: medianLagSchema,
    academyRegistrationToPocketRegistration: medianLagSchema,
    pocketRegistrationToFirstDeposit: medianLagSchema,
    selectedClickToFirstDeposit: medianLagSchema,
  })
  .strict();
export type CohortMedians = z.infer<typeof cohortMediansSchema>;

/**
 * The observation window.
 *
 * `maturityAssessment` is pinned to `not_scored`: the backend ships no
 * empirical maturity model, and a parse that accepted "mature" would be this
 * file agreeing to display a forecast the API does not make.
 */
export const followupMetadataSchema = z
  .object({
    cohortStartLocal: z.string().min(1).nullable(),
    cohortEndLocal: z.string().min(1),
    cutoffLocal: z.string().min(1),
    cohortStartUtc: z.string().datetime().nullable(),
    cohortEndUtc: z.string().datetime(),
    cutoffUtc: z.string().datetime(),
    minimumPossibleFollowupSeconds: z.number().int().nonnegative(),
    maximumPossibleFollowupSeconds: z.number().int().nonnegative().nullable(),
    cohortIntervalFullyBeforeCutoff: z.boolean(),
    maturityAssessment: z.literal("not_scored"),
    maturityReason: z.literal("empirical_maturity_model_not_implemented"),
  })
  .strict();
export type FollowupMetadata = z.infer<typeof followupMetadataSchema>;

export const reportCutoffSchema = z
  .object({
    cutoffUtc: z.string().datetime(),
    cutoffLocal: z.string().min(1),
    cutoffDateLocal: z.string().min(1).nullable(),
    source: z.enum(["report_clock", "explicit_date"]),
    clampedToReportClock: z.boolean(),
    intervalConvention: z.literal("cutoff_exclusive"),
  })
  .strict();
export type ReportCutoff = z.infer<typeof reportCutoffSchema>;

const cohortRateDenominatorsSchema = z
  .object({
    pocketRegistrationRate: z.string().min(1),
    firstDepositRate: z.string().min(1),
    pocketToFirstDepositRate: z.string().min(1),
  })
  .strict();

/** The mode identity every cohort response leads with. */
const cohortIdentityShape = {
  mode: z.literal("acquisition_cohort"),
  cohortPopulation: z.literal("registered_attributed_learners"),
  cohortAnchor: z.literal("selected_acquisition_click"),
  cohortModeExplanation: z.string().min(1),
  cohortVersusEventDate: z.string().min(1),
  rateDenominators: cohortRateDenominatorsSchema,
  cohortPeriod: resolvedPeriodSchema,
  reportCutoff: reportCutoffSchema,
  filters: analyticsFiltersSchema,
} as const;

/* ---------------------------------------------------------- cohort summary */

export const cohortSummarySchema = z
  .object({
    ...cohortIdentityShape,
    metrics: cohortCountsSchema,
    rates: cohortRatesSchema,
    medianLags: cohortMediansSchema,
    followup: followupMetadataSchema,
    firstDepositAmount: amountAvailabilitySchema,
    integrityWarnings: z.unknown(),
    dataAvailability: cohortDataAvailabilitySchema,
    generatedAt: z.string().datetime(),
  })
  .strict();
export type CohortSummary = z.infer<typeof cohortSummarySchema>;

/* ------------------------------------------------------ cohort time series */

export const cohortBucketSchema = z
  .object({
    localLabel: z.string().min(1),
    acquisitionStartUtc: z.string().datetime().nullable(),
    acquisitionEndUtc: z.string().datetime().nullable(),
    metrics: cohortCountsSchema,
    rates: cohortRatesSchema,
    medianLags: cohortMediansSchema,
    followup: followupMetadataSchema.nullable(),
  })
  .strict();
export type CohortBucket = z.infer<typeof cohortBucketSchema>;

export const cohortTimeseriesSchema = z
  .object({
    ...cohortIdentityShape,
    group: bucketGroupSchema,
    bucketCap: z.number().int().positive(),
    buckets: z.array(cohortBucketSchema),
    totals: z
      .object({
        metrics: cohortCountsSchema,
        rates: cohortRatesSchema,
        medianLags: cohortMediansSchema,
        followup: followupMetadataSchema,
      })
      .strict(),
    reconciliation: z
      .object({
        countsAreAdditive: z.literal(true),
        // Pinned false: the UI must never average bucket rates or medians.
        ratesAreAdditive: z.literal(false),
        mediansAreAdditive: z.literal(false),
        explanation: z.string().min(1),
      })
      .strict(),
    firstDepositAmount: amountAvailabilitySchema,
    dataAvailability: cohortDataAvailabilitySchema,
    generatedAt: z.string().datetime(),
  })
  .strict();
export type CohortTimeseries = z.infer<typeof cohortTimeseriesSchema>;

/* --------------------------------------------------------- cohort breakdown */

export const cohortBreakdownRowSchema = z
  .object({
    id: z.string().min(1),
    code: z.string().min(1).nullable(),
    displayName: z.string().min(1).nullable(),
    status: z.string().min(1).nullable(),
    availability: z.string().min(1).nullable(),
    archived: z.boolean(),
    affiliatePartnerId: z.string().min(1).nullable(),
    affiliateCampaignId: z.string().min(1).nullable(),
    metrics: cohortCountsSchema,
    rates: cohortRatesSchema,
    medianLags: cohortMediansSchema,
    followup: followupMetadataSchema,
    firstDepositAmount: amountAvailabilitySchema,
    lastCohortActivityAt: z.string().datetime().nullable(),
  })
  .strict();
export type CohortBreakdownRow = z.infer<typeof cohortBreakdownRowSchema>;

export const cohortBreakdownSchema = z
  .object({
    ...cohortIdentityShape,
    dimension: breakdownDimensionSchema,
    includeZeroActivity: z.boolean(),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    rows: z.array(cohortBreakdownRowSchema),
    cohortTotals: z
      .object({
        metrics: cohortCountsSchema,
        rates: cohortRatesSchema,
        followup: followupMetadataSchema,
      })
      .strict(),
    firstDepositAmount: amountAvailabilitySchema,
    dataAvailability: cohortDataAvailabilitySchema,
    generatedAt: z.string().datetime(),
  })
  .strict();
export type CohortBreakdown = z.infer<typeof cohortBreakdownSchema>;
