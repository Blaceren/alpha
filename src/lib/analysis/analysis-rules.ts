/**
 * AFD-5D1 — the deterministic rules.
 *
 * PURE AND SYNCHRONOUS BY DESIGN. Every rule reads the already-loaded
 * `AnalysisInput` and returns raw findings. Nothing here opens a database,
 * reads a clock, consults configuration or calls a model, so the same input
 * always produces the same report — which is what makes the catalog's promises
 * testable rather than merely stated.
 *
 * WHAT A RULE IS ALLOWED TO DO: notice that a published value crosses a
 * published threshold, and attach that value as evidence. What it may never do:
 * explain a value, extrapolate one, rank traffic, or recommend an action. The
 * sentence is the catalog's; the rule only decides whether the fact is worth
 * printing and hands over the operands.
 *
 * ORDER IS STABLE. Rules run in a fixed sequence and each emits in a fixed
 * order, so two runs over one input produce byte-identical reports.
 */
import {
  ANALYSIS_THRESHOLDS,
  type Evidence,
  type RawFinding,
} from "./analysis-contract";
import {
  countChangePercent,
  percentAtLeast,
  ratioDifferencePoints,
  ratioGreater,
  ratioToPercent,
  readableSeconds,
  sharePercent,
} from "./analysis-format";
import {
  COHORT_RATE_DENOMINATORS,
  RATIO_DENOMINATORS,
  type AnalysisInput,
  type CohortInput,
  type EventDateInput,
} from "./analysis-input";
import type { MetricCounts } from "@/lib/analytics/affiliate-sources";
import { computeRatios } from "@/lib/analytics/affiliate-queries";

/**
 * Ratios for ONE bucket or ONE breakdown member.
 *
 * Delegated to the accepted owner rather than reimplemented: a second
 * definition of a conversion rate is exactly the kind of quiet divergence this
 * phase is forbidden to introduce. The counts are already loaded; only the
 * published formula is applied to them.
 */
const ratiosOf = computeRatios;

/* ------------------------------------------------------------- evidence */

const ev = (
  key: string,
  value: string | number,
  source: Evidence["source"],
  dimensionId?: number,
): Evidence => ({
  key,
  value: String(value),
  source,
  ...(dimensionId === undefined ? {} : { dimensionId }),
});

/** Metrics the report leads with. Deliberately the funnel, not every column. */
const HEADLINE_METRICS = [
  "qualifiedClicks",
  "academyRegistrations",
  "pocketRegistrations",
  "confirmedFirstDeposits",
] as const;

/** Metrics whose series endpoints are compared. Counts only, never rates. */
const SERIES_METRICS = [
  "qualifiedClicks",
  "academyRegistrations",
  "pocketRegistrations",
  "confirmedFirstDeposits",
] as const;

/* ------------------------------------------------------- data sufficiency */

/**
 * Is there anything to describe at all?
 *
 * An empty period is not "0 % conversion, unchanged": it is the absence of the
 * events those sentences would be about. The report says `insufficient_data` and
 * stops rather than dressing nothing up as something.
 */
export function eventDateHasData(input: EventDateInput): boolean {
  return (
    input.counts.qualifiedClicks > 0 ||
    input.counts.academyRegistrations > 0 ||
    input.counts.pocketRegistrations > 0 ||
    input.counts.confirmedFirstDeposits > 0 ||
    input.counts.pendingIdentityDeposits > 0 ||
    input.counts.conflictingDeposits > 0
  );
}

export function cohortHasData(input: CohortInput): boolean {
  return input.counts.cohortLearners > 0;
}

/* ------------------------------------------------- event-date: the levels */

function eventDateLevels(input: EventDateInput): RawFinding[] {
  const findings: RawFinding[] = [];

  for (const metric of HEADLINE_METRICS) {
    findings.push({
      code: "period_volume",
      operands: { metric, value: String(input.counts[metric]) },
      evidence: [ev(metric, input.counts[metric], "summary")],
    });
  }

  for (const [rate, value] of Object.entries(input.ratios)) {
    const denominatorMetric = RATIO_DENOMINATORS[rate as keyof typeof RATIO_DENOMINATORS];
    const denominator = input.counts[denominatorMetric];

    // A null ratio means an empty denominator, which is a different fact from a
    // zero rate — the catalog says so in words.
    if (value === null) {
      findings.push({
        code: "funnel_rate_undefined",
        operands: { rate, denominatorMetric },
        evidence: [ev(denominatorMetric, denominator, "summary")],
      });
      continue;
    }

    const numeratorMetric = NUMERATOR_OF[rate as keyof typeof NUMERATOR_OF];
    findings.push({
      code: "funnel_rate_level",
      operands: {
        rate,
        percent: ratioToPercent(value),
        numerator: String(input.counts[numeratorMetric]),
        denominator: String(denominator),
        denominatorMetric,
      },
      evidence: [
        ev(rate, value, "summary"),
        ev(numeratorMetric, input.counts[numeratorMetric], "summary"),
        ev(denominatorMetric, denominator, "summary"),
      ],
    });
  }

  // The attributed/unattributed split, only where it reconciles.
  if (!input.filtered && input.attributedCounts && input.unattributedCounts) {
    for (const metric of ["academyRegistrations", "confirmedFirstDeposits"] as const) {
      const attributed = input.attributedCounts[metric];
      const unattributed = input.unattributedCounts[metric];
      const total = input.counts[metric];
      const share = sharePercent(attributed, total);
      if (share === null) continue;
      findings.push({
        code: "coverage_split",
        operands: {
          metric,
          attributed: String(attributed),
          unattributed: String(unattributed),
          total: String(total),
          attributedPercent: share,
        },
        evidence: [
          ev(`${metric}.attributed`, attributed, "summary"),
          ev(`${metric}.unattributed`, unattributed, "summary"),
          ev(`${metric}.total`, total, "summary"),
        ],
      });
    }
  }

  return findings;
}

/** Which count is the numerator of each published ratio. Mirrors computeRatios. */
const NUMERATOR_OF = {
  qualifiedClickToAcademyRegistrationRate: "academyRegistrations",
  academyRegistrationToPocketRegistrationRate: "pocketRegistrations",
  pocketRegistrationToFirstDepositRate: "confirmedFirstDeposits",
  qualifiedClickToPocketRegistrationRate: "pocketRegistrations",
  qualifiedClickToFirstDepositRate: "confirmedFirstDeposits",
} as const satisfies Record<string, keyof MetricCounts>;

/* ------------------------------------------------- event-date: the change */

/**
 * The first and last buckets of the series, compared.
 *
 * TWO ENDPOINTS, NOT A TREND. A trend is a claim about the shape of everything
 * in between and about what comes next; this is the arithmetic difference
 * between two published buckets, and the sentence names both of them so a reader
 * can see exactly what was compared.
 *
 * Needs at least two buckets. With one there is nothing to compare, and
 * comparing a bucket with itself would print a confident "no change".
 */
function eventDateChange(input: EventDateInput): RawFinding[] {
  const findings: RawFinding[] = [];
  if (input.buckets.length < 2) return findings;

  const first = input.buckets[0]!;
  const last = input.buckets[input.buckets.length - 1]!;

  for (const metric of SERIES_METRICS) {
    const from = first.counts[metric];
    const to = last.counts[metric];
    const change = countChangePercent(from, to);

    if (change === null || !percentAtLeast(change, ANALYSIS_THRESHOLDS.seriesCountChangeMinRelativePercent)) {
      findings.push({
        code: "series_flat",
        operands: {
          metric,
          firstLabel: first.localLabel,
          lastLabel: last.localLabel,
          thresholdPercent: ANALYSIS_THRESHOLDS.seriesCountChangeMinRelativePercent,
        },
        evidence: [
          ev(`${metric}.first`, from, "timeseries"),
          ev(`${metric}.last`, to, "timeseries"),
        ],
      });
      continue;
    }

    findings.push({
      code: "series_count_change",
      operands: {
        metric,
        direction: to > from ? "up" : "down",
        firstLabel: first.localLabel,
        firstValue: String(from),
        lastLabel: last.localLabel,
        lastValue: String(to),
        changePercent: change,
      },
      evidence: [
        ev(`${metric}.first`, from, "timeseries"),
        ev(`${metric}.last`, to, "timeseries"),
      ],
    });
  }

  // Rate change between the same two endpoints, recomputed by the ACCEPTED
  // owner over each bucket's own counts — never by dividing anything new.
  const firstRates = ratiosOf(first.counts);
  const lastRates = ratiosOf(last.counts);

  for (const rate of Object.keys(firstRates) as (keyof typeof firstRates)[]) {
    const from = firstRates[rate];
    const to = lastRates[rate];
    if (from === null || to === null) continue;

    const points = ratioDifferencePoints(to, from);
    if (!percentAtLeast(points, ANALYSIS_THRESHOLDS.seriesRateChangeMinPoints)) continue;

    findings.push({
      code: "series_rate_change",
      operands: {
        rate,
        direction: ratioGreater(to, from) ? "up" : "down",
        firstLabel: first.localLabel,
        firstPercent: ratioToPercent(from),
        lastLabel: last.localLabel,
        lastPercent: ratioToPercent(to),
        changePoints: points,
      },
      evidence: [
        ev(`${rate}.first`, from, "timeseries"),
        ev(`${rate}.last`, to, "timeseries"),
      ],
    });
  }

  return findings;
}

/* -------------------------------------------- event-date: the composition */

function eventDateComposition(input: EventDateInput): RawFinding[] {
  const findings: RawFinding[] = [];
  if (input.breakdown.length === 0) return findings;

  findings.push({
    code: "breakdown_member_count",
    operands: { dimension: input.dimension, value: String(input.breakdown.length) },
    evidence: [ev("breakdownMembers", input.breakdown.length, "breakdown")],
  });

  // Concentration: does one member hold most of a metric? A share, not a verdict.
  for (const metric of ["academyRegistrations", "confirmedFirstDeposits"] as const) {
    const total = input.breakdownTotals[metric];
    if (total === 0) continue;

    const top = [...input.breakdown].sort((a, b) => b.counts[metric] - a.counts[metric])[0];
    if (!top || top.counts[metric] === 0) continue;

    const share = sharePercent(top.counts[metric], total);
    if (share === null || !percentAtLeast(share, ANALYSIS_THRESHOLDS.concentrationSharePercent)) {
      continue;
    }

    findings.push({
      code: "breakdown_concentration",
      operands: {
        dimension: input.dimension,
        dimensionId: String(top.dimensionId),
        metric,
        value: String(top.counts[metric]),
        total: String(total),
        sharePercent: share,
      },
      evidence: [
        ev(metric, top.counts[metric], "breakdown", top.dimensionId),
        ev(`${metric}.attributedTotal`, total, "summary"),
      ],
      dimensionId: top.dimensionId,
    });
  }

  return findings;
}

/* ---------------------------------------------- event-date: the contrasts */

/**
 * Measured differences between one member and the aggregate.
 *
 * THESE ARE FACTS, NOT ADVICE. "Ссылка #7: клик → регистрация 2,1 % против
 * 8,4 % по разбивке" states two published numbers and their gap. It does not say
 * the link is bad, why it differs, or what to do about it — and the catalog has
 * no sentence that could.
 *
 * Members below the volume thresholds are skipped entirely: a difference
 * computed on four clicks is arithmetic noise, and printing it would invite it
 * to be read as a finding about the member.
 */
function eventDateContrasts(input: EventDateInput): RawFinding[] {
  const findings: RawFinding[] = [];
  const aggregate = input.ratios.qualifiedClickToAcademyRegistrationRate;

  for (const row of [...input.breakdown].sort((a, b) => a.dimensionId - b.dimensionId)) {
    const clicks = row.counts.qualifiedClicks;
    const registrations = row.counts.academyRegistrations;
    const pocket = row.counts.pocketRegistrations;
    const deposits = row.counts.confirmedFirstDeposits;

    if (clicks >= ANALYSIS_THRESHOLDS.memberMinQualifiedClicks && registrations === 0) {
      findings.push({
        code: "member_clicks_without_registrations",
        operands: {
          dimension: input.dimension,
          dimensionId: String(row.dimensionId),
          clicks: String(clicks),
        },
        evidence: [
          ev("qualifiedClicks", clicks, "breakdown", row.dimensionId),
          ev("academyRegistrations", 0, "breakdown", row.dimensionId),
        ],
        dimensionId: row.dimensionId,
      });
    }

    if (pocket >= ANALYSIS_THRESHOLDS.memberMinPocketRegistrations && deposits === 0) {
      findings.push({
        code: "member_registrations_without_deposits",
        operands: {
          dimension: input.dimension,
          dimensionId: String(row.dimensionId),
          pocketRegistrations: String(pocket),
        },
        evidence: [
          ev("pocketRegistrations", pocket, "breakdown", row.dimensionId),
          ev("confirmedFirstDeposits", 0, "breakdown", row.dimensionId),
        ],
        dimensionId: row.dimensionId,
      });
    }

    // The rate contrast, only where both sides exist and the member is big
    // enough for the comparison to be about the member rather than the sample.
    if (aggregate === null || clicks < ANALYSIS_THRESHOLDS.memberMinQualifiedClicks) continue;
    const memberRate = ratiosOf(row.counts).qualifiedClickToAcademyRegistrationRate;
    if (memberRate === null) continue;

    const points = ratioDifferencePoints(memberRate, aggregate);
    if (!percentAtLeast(points, ANALYSIS_THRESHOLDS.memberRateDifferenceMinPoints)) continue;

    findings.push({
      code: "member_rate_differs_from_aggregate",
      operands: {
        dimension: input.dimension,
        dimensionId: String(row.dimensionId),
        rate: "qualifiedClickToAcademyRegistrationRate",
        memberPercent: ratioToPercent(memberRate),
        aggregatePercent: ratioToPercent(aggregate),
        differencePoints: points,
        direction: ratioGreater(memberRate, aggregate) ? "up" : "down",
        // AFD-5D2A — the denominator this member's rate rests on, so the
        // published support tier is read from the finding itself rather than
        // recomputed anywhere. It is the same `clicks` count the eligibility
        // test above already used; no new value is produced.
        memberDenominator: String(clicks),
      },
      evidence: [
        ev("qualifiedClickToAcademyRegistrationRate", memberRate, "breakdown", row.dimensionId),
        ev("qualifiedClickToAcademyRegistrationRate.aggregate", aggregate, "summary"),
      ],
      dimensionId: row.dimensionId,
    });
  }

  return findings;
}

/* ------------------------------------------------- event-date: the caveats */

function eventDateWarnings(input: EventDateInput): RawFinding[] {
  const findings: RawFinding[] = [];

  if (input.counts.conflictingDeposits > 0) {
    findings.push({
      code: "conflicting_deposits_present",
      operands: { value: String(input.counts.conflictingDeposits) },
      evidence: [ev("conflictingDeposits", input.counts.conflictingDeposits, "summary")],
    });
  }

  if (input.counts.pendingIdentityDeposits > 0) {
    findings.push({
      code: "pending_identity_deposits_present",
      operands: { value: String(input.counts.pendingIdentityDeposits) },
      evidence: [ev("pendingIdentityDeposits", input.counts.pendingIdentityDeposits, "summary")],
    });
  }

  if (!input.amount.amountAggregationAvailable) {
    findings.push({
      code: "amount_aggregation_unavailable",
      operands: { reason: input.amount.unavailableReason },
      evidence: [ev("firstDepositAmount.unavailableReason", input.amount.unavailableReason, "availability")],
    });
  }

  // Small-sample flags for every rate the report printed a level for.
  for (const [rate, value] of Object.entries(input.ratios)) {
    if (value === null) continue;
    const denominatorMetric = RATIO_DENOMINATORS[rate as keyof typeof RATIO_DENOMINATORS];
    const denominator = input.counts[denominatorMetric];
    if (denominator >= ANALYSIS_THRESHOLDS.minRateDenominator) continue;
    findings.push({
      code: "small_sample_rate",
      operands: {
        rate,
        denominator: String(denominator),
        threshold: String(ANALYSIS_THRESHOLDS.minRateDenominator),
      },
      evidence: [ev(denominatorMetric, denominator, "summary")],
    });
  }

  // The timeseries route publishes a reconciliation proof; this repeats it as a
  // finding so a mismatch cannot be missed by a reader who only reads the report.
  for (const metric of SERIES_METRICS) {
    const bucketSum = input.buckets.reduce((sum, bucket) => sum + bucket.counts[metric], 0);
    if (bucketSum === input.counts[metric]) continue;
    findings.push({
      code: "series_reconciliation_mismatch",
      operands: {
        metric,
        bucketSum: String(bucketSum),
        periodTotal: String(input.counts[metric]),
      },
      evidence: [
        ev(`${metric}.bucketSum`, bucketSum, "timeseries"),
        ev(`${metric}.periodTotal`, input.counts[metric], "summary"),
      ],
    });
  }

  return findings;
}

/* --------------------------------------------------------- cohort rules */

function cohortLevels(input: CohortInput): RawFinding[] {
  const findings: RawFinding[] = [
    {
      code: "cohort_size",
      operands: { value: String(input.counts.cohortLearners) },
      evidence: [ev("cohortLearners", input.counts.cohortLearners, "summary")],
    },
  ];

  for (const [rate, value] of Object.entries(input.rates)) {
    const denominatorMetric =
      COHORT_RATE_DENOMINATORS[rate as keyof typeof COHORT_RATE_DENOMINATORS];
    const denominator = input.counts[denominatorMetric as keyof typeof input.counts];

    if (value === null) {
      findings.push({
        code: "cohort_rate_undefined",
        operands: { rate, denominatorMetric },
        evidence: [ev(denominatorMetric, denominator, "summary")],
      });
      continue;
    }

    const numeratorMetric = COHORT_NUMERATOR_OF[rate as keyof typeof COHORT_NUMERATOR_OF];
    findings.push({
      code: "cohort_rate_level",
      operands: {
        rate,
        percent: ratioToPercent(value),
        numerator: String(input.counts[numeratorMetric]),
        denominator: String(denominator),
        denominatorMetric,
      },
      evidence: [
        ev(rate, value, "summary"),
        ev(numeratorMetric, input.counts[numeratorMetric], "summary"),
        ev(denominatorMetric, denominator, "summary"),
      ],
    });
  }

  for (const [lag, median] of Object.entries(input.medians)) {
    if (median.medianSeconds === null || median.sampleSize === 0) {
      findings.push({
        code: "cohort_median_unavailable",
        operands: { lag },
        evidence: [ev(`${lag}.sampleSize`, median.sampleSize, "summary")],
      });
      continue;
    }
    findings.push({
      code: "cohort_median_lag",
      operands: {
        lag,
        seconds: readableSeconds(median.medianSeconds),
        sampleSize: String(median.sampleSize),
      },
      evidence: [
        ev(`${lag}.medianSeconds`, median.medianSeconds, "summary"),
        ev(`${lag}.sampleSize`, median.sampleSize, "summary"),
      ],
    });
  }

  return findings;
}

const COHORT_NUMERATOR_OF = {
  pocketRegistrationRate: "pocketRegisteredLearners",
  firstDepositRate: "firstDepositLearners",
  pocketToFirstDepositRate: "firstDepositLearners",
} as const;

function cohortWarnings(input: CohortInput): RawFinding[] {
  const findings: RawFinding[] = [];

  if (input.cutoff.clampedToReportClock) {
    findings.push({
      code: "cohort_cutoff_clamped",
      operands: { cutoff: input.cutoff.cutoffLocal },
      evidence: [ev("cutoffLocal", input.cutoff.cutoffLocal, "period")],
    });
  }

  if (input.integrity.missingOrDuplicateRegistrationCount > 0) {
    findings.push({
      code: "cohort_missing_or_duplicate_registration",
      operands: { value: String(input.integrity.missingOrDuplicateRegistrationCount) },
      evidence: [
        ev(
          "missingOrDuplicateRegistrationCount",
          input.integrity.missingOrDuplicateRegistrationCount,
          "integrity",
        ),
      ],
    });
  }

  if (input.integrity.duplicateFirstDepositCount > 0) {
    findings.push({
      code: "cohort_duplicate_first_deposit",
      operands: { value: String(input.integrity.duplicateFirstDepositCount) },
      evidence: [
        ev("duplicateFirstDepositCount", input.integrity.duplicateFirstDepositCount, "integrity"),
      ],
    });
  }

  for (const [lag, median] of Object.entries(input.medians)) {
    if (median.negativeDurationCount === 0) continue;
    findings.push({
      code: "negative_duration_observed",
      operands: { lag, value: String(median.negativeDurationCount) },
      evidence: [ev(`${lag}.negativeDurationCount`, median.negativeDurationCount, "summary")],
    });
  }

  if (!input.amount.amountAggregationAvailable) {
    findings.push({
      code: "amount_aggregation_unavailable",
      operands: { reason: input.amount.unavailableReason },
      evidence: [
        ev("firstDepositAmount.unavailableReason", input.amount.unavailableReason, "availability"),
      ],
    });
  }

  for (const [rate, value] of Object.entries(input.rates)) {
    if (value === null) continue;
    const denominatorMetric =
      COHORT_RATE_DENOMINATORS[rate as keyof typeof COHORT_RATE_DENOMINATORS];
    const denominator = input.counts[denominatorMetric as keyof typeof input.counts];
    if (denominator >= ANALYSIS_THRESHOLDS.minRateDenominator) continue;
    findings.push({
      code: "small_sample_rate",
      operands: {
        rate,
        denominator: String(denominator),
        threshold: String(ANALYSIS_THRESHOLDS.minRateDenominator),
      },
      evidence: [ev(denominatorMetric, denominator, "summary")],
    });
  }

  return findings;
}

function cohortComposition(input: CohortInput): RawFinding[] {
  if (input.breakdown.length === 0) return [];
  return [
    {
      code: "breakdown_member_count",
      operands: { dimension: input.dimension, value: String(input.breakdown.length) },
      evidence: [ev("breakdownMembers", input.breakdown.length, "breakdown")],
    },
  ];
}

/* ------------------------------------------------------------- questions */

/**
 * What the report cannot answer, stated every time.
 *
 * These are unconditional on purpose. A reader who has just been shown a drop
 * will look for a reason, and the honest thing is to say plainly that this
 * report does not hold one — every time, not only when somebody remembered to
 * add a caveat.
 */
export function standingQuestions(): RawFinding[] {
  return [
    { code: "question_cause_not_available", operands: {}, evidence: [] },
    { code: "question_forecast_not_available", operands: {}, evidence: [] },
    { code: "question_traffic_quality_not_available", operands: {}, evidence: [] },
    { code: "question_redeposits_unavailable", operands: {}, evidence: [] },
    { code: "question_current_balance_unavailable", operands: {}, evidence: [] },
    { code: "question_education_timeline_unavailable", operands: {}, evidence: [] },
  ];
}

/* ---------------------------------------------------------------- driver */

/**
 * Run every rule for the mode.
 *
 * When the input is insufficient the report emits the `insufficient_data`
 * finding and the standing questions, and NOTHING else — no levels, no changes,
 * no contrasts.
 */
export function runRules(input: AnalysisInput): readonly RawFinding[] {
  if (input.mode === "event_date") {
    if (!eventDateHasData(input)) {
      return [
        {
          code: "insufficient_data",
          operands: { reason: "no_events_in_period" },
          evidence: [
            ev("qualifiedClicks", input.counts.qualifiedClicks, "summary"),
            ev("academyRegistrations", input.counts.academyRegistrations, "summary"),
          ],
        },
        ...standingQuestions(),
      ];
    }
    return [
      ...eventDateLevels(input),
      ...eventDateChange(input),
      ...eventDateComposition(input),
      ...eventDateWarnings(input),
      ...eventDateContrasts(input),
      ...standingQuestions(),
    ];
  }

  if (!cohortHasData(input)) {
    return [
      {
        code: "insufficient_data",
        operands: { reason: "empty_cohort" },
        evidence: [ev("cohortLearners", input.counts.cohortLearners, "summary")],
      },
      ...standingQuestions(),
    ];
  }

  return [
    ...cohortLevels(input),
    ...cohortComposition(input),
    ...cohortWarnings(input),
    ...standingQuestions(),
  ];
}
