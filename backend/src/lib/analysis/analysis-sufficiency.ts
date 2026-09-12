/**
 * AFD-5D2A — the authoritative sufficiency verdict.
 *
 * WHY THIS FILE EXISTS. AFD-5D2 shipped a CRM that DERIVED a "partial" state in
 * the browser, from the evidence sources the backend happened to cite. That was
 * disclosed at the time and it was the right call for a UI phase, but it is the
 * wrong owner: a browser deciding whether a report is complete is a second
 * analytical engine, and two engines eventually disagree. This module moves that
 * decision to the backend, where the inputs actually are.
 *
 * IT ADDS NO DATA. Every value read here is already loaded by
 * `analysis-input.ts` for the existing rules — the same counts, the same
 * availability record, the same integrity record, the same cutoff, the same
 * buckets. There is no query, no aggregate, no metric and no migration. The
 * whole module is a pure function of an `AnalysisInput` that already exists.
 *
 * WHAT AN ISSUE IS, AND IS NOT. An issue means "a comparison or a section the
 * report would otherwise have produced is unavailable, immature, truncated or
 * integrity-limited". An issue is NOT "a section came back empty": an empty
 * period, an empty cohort and a funnel step nobody reached are all VALID
 * FACTUAL RESULTS, and reporting them as data problems would teach an operator
 * to distrust true answers. §4 of the phase brief says this explicitly and the
 * tests pin it.
 *
 * NO CAUSES. NO FORECASTS. NO RECOMMENDATIONS. An issue names what could not be
 * established and points at the stored value that says so.
 */
import { ANALYSIS_THRESHOLDS, type Evidence } from "./analysis-contract";
import type { AnalysisInput, CohortInput, EventDateInput } from "./analysis-input";
import { RATIO_DENOMINATORS, COHORT_RATE_DENOMINATORS } from "./analysis-input";
import { cohortHasData, eventDateHasData } from "./analysis-rules";

/* --------------------------------------------------------------- vocabulary */

/**
 * The top-level result status.
 *
 * Deliberately three words an operator can act on rather than a score:
 * `ok` — read it; `partial` — read it and read the issues first;
 * `insufficient_data` — there is nothing here to read.
 */
export const ANALYSIS_STATUSES = ["ok", "partial", "insufficient_data"] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

/**
 * The sufficiency status.
 *
 * A separate vocabulary from `status` because it answers a narrower question —
 * "how complete is the evidence" rather than "what should you do with this
 * report" — but the two can never disagree, and `assertStatusesAgree` below
 * makes that a runtime invariant rather than a convention.
 */
export const SUFFICIENCY_STATUSES = ["complete", "partial", "insufficient"] as const;
export type SufficiencyStatus = (typeof SUFFICIENCY_STATUSES)[number];

/**
 * The CLOSED reason-code catalog.
 *
 * A code may be added under review; it may never be repurposed, because a
 * consumer branches on it. `assertIssueIsCatalogLegal` refuses anything outside
 * this list BEFORE the response is published, so an unknown internal code fails
 * the request rather than reaching an operator as an unexplained string.
 */
export const SUFFICIENCY_REASON_CODES = [
  "SAMPLE_TOO_SMALL",
  "COHORT_FOLLOWUP_INCOMPLETE",
  "COMPARISON_PERIOD_UNAVAILABLE",
  "MIXED_CURRENCY",
  "BREAKDOWN_TRUNCATED",
  "METRIC_UNAVAILABLE",
  "INTEGRITY_WARNING",
] as const;
export type SufficiencyReasonCode = (typeof SUFFICIENCY_REASON_CODES)[number];

/**
 * One thing the report could not establish.
 *
 * `scope` names WHAT is limited — a rate key, a metric key, a lag key — using
 * the same spelling the aggregates already use. It is never a person, never an
 * id and never a free sentence.
 *
 * `details` is a bounded map of scalars carrying the numbers behind the code, so
 * a reader can see WHY without another request. It is not prose and it is not a
 * payload: every value here is already published elsewhere in the response.
 */
export type SufficiencyIssue = {
  readonly code: SufficiencyReasonCode;
  readonly scope?: string;
  readonly details?: Readonly<Record<string, string>>;
  readonly evidence: readonly Evidence[];
};

export type DataSufficiency = {
  readonly status: SufficiencyStatus;
  readonly issues: readonly SufficiencyIssue[];
};

/* ------------------------------------------------------------------ helpers */

const ev = (key: string, value: string | number, source: Evidence["source"]): Evidence => ({
  key,
  value: String(value),
  source,
});

/* --------------------------------------------------------- event-date issues */

function eventDateIssues(input: EventDateInput): SufficiencyIssue[] {
  const issues: SufficiencyIssue[] = [];

  /* -- SAMPLE_TOO_SMALL -----------------------------------------------------
   *
   * EXACTLY the test the `small_sample_rate` rule already applies, reading the
   * same threshold. A rate whose denominator is below it is still printed — the
   * report does not hide it — but the comparison it supports is not one an
   * operator should lean on, and that is a sufficiency fact.
   *
   * A rate that is `null` is SKIPPED: a zero denominator produced no rate at
   * all, which is emptiness rather than a small sample.
   */
  for (const [rate, value] of Object.entries(input.ratios)) {
    if (value === null) continue;
    const denominatorMetric = RATIO_DENOMINATORS[rate as keyof typeof RATIO_DENOMINATORS];
    const denominator = input.counts[denominatorMetric];
    if (denominator >= ANALYSIS_THRESHOLDS.minRateDenominator) continue;
    issues.push({
      code: "SAMPLE_TOO_SMALL",
      scope: rate,
      details: {
        denominatorMetric,
        denominator: String(denominator),
        threshold: String(ANALYSIS_THRESHOLDS.minRateDenominator),
      },
      evidence: [ev(denominatorMetric, denominator, "summary")],
    });
  }

  /* -- COMPARISON_PERIOD_UNAVAILABLE ----------------------------------------
   *
   * The change rules compare the FIRST and LAST bucket. With fewer than two
   * buckets there is no pair, so every series comparison the report would have
   * made is unavailable. This is the same `< 2` test `eventDateChange` uses to
   * return early — read here rather than reimplemented.
   *
   * This is NOT emptiness: a single-bucket period can be full of events. What is
   * missing is the second point to compare it against.
   */
  if (input.buckets.length < 2) {
    issues.push({
      code: "COMPARISON_PERIOD_UNAVAILABLE",
      scope: "series",
      details: { bucketCount: String(input.buckets.length), required: "2" },
      evidence: [ev("bucketCount", input.buckets.length, "timeseries")],
    });
  }

  /* -- MIXED_CURRENCY / METRIC_UNAVAILABLE ----------------------------------
   *
   * The amount aggregate publishes WHY it is unavailable. Exactly one of its
   * reasons is a limitation:
   *
   *   `currency_unspecified_or_mixed` — the deposits exist and cannot be summed.
   *   `no_confirmed_first_deposits`   — there is nothing to sum. VALID EMPTINESS,
   *                                     and deliberately NOT an issue (§4).
   *
   * The `default` branch exists so the mapping is TOTAL: if the aggregate ever
   * gains a third reason, it surfaces as METRIC_UNAVAILABLE instead of being
   * silently dropped.
   */
  if (!input.amount.amountAggregationAvailable) {
    const reason = input.amount.unavailableReason;
    if (reason === "currency_unspecified_or_mixed") {
      issues.push({
        code: "MIXED_CURRENCY",
        scope: "firstDepositAmount",
        details: { reason },
        evidence: [ev("firstDepositAmount.unavailableReason", reason, "availability")],
      });
    } else if (reason !== "no_confirmed_first_deposits") {
      issues.push({
        code: "METRIC_UNAVAILABLE",
        scope: "firstDepositAmount",
        details: { reason: String(reason) },
        evidence: [ev("firstDepositAmount.unavailableReason", String(reason), "availability")],
      });
    }
  }

  /* -- INTEGRITY_WARNING ----------------------------------------------------
   *
   * The timeseries route publishes a reconciliation proof: the buckets must sum
   * to the period total. A mismatch means two stored views of the same metric
   * disagree, which limits every comparison built on either.
   */
  for (const metric of ["qualifiedClicks", "academyRegistrations", "pocketRegistrations", "confirmedFirstDeposits"] as const) {
    const bucketSum = input.buckets.reduce((sum, bucket) => sum + bucket.counts[metric], 0);
    if (bucketSum === input.counts[metric]) continue;
    issues.push({
      code: "INTEGRITY_WARNING",
      scope: metric,
      details: { bucketSum: String(bucketSum), periodTotal: String(input.counts[metric]) },
      evidence: [
        ev(`${metric}.bucketSum`, bucketSum, "timeseries"),
        ev(`${metric}.periodTotal`, input.counts[metric], "summary"),
      ],
    });
  }

  return issues;
}

/* ------------------------------------------------------------ cohort issues */

function cohortIssues(input: CohortInput): SufficiencyIssue[] {
  const issues: SufficiencyIssue[] = [];

  /* -- COHORT_FOLLOWUP_INCOMPLETE -------------------------------------------
   *
   * The cutoff was clamped to the report clock, so the observation window is
   * shorter than the one that was asked for and the cohort has not finished
   * maturing. Every downstream rate is therefore a floor rather than a final
   * value — which is exactly what an operator must know before comparing two
   * cohorts.
   */
  if (input.cutoff.clampedToReportClock) {
    issues.push({
      code: "COHORT_FOLLOWUP_INCOMPLETE",
      scope: "cohort",
      details: { cutoffLocal: input.cutoff.cutoffLocal, source: input.cutoff.source },
      evidence: [ev("cutoffLocal", input.cutoff.cutoffLocal, "period")],
    });
  }

  /* -- SAMPLE_TOO_SMALL ------------------------------------------------------ */
  for (const [rate, value] of Object.entries(input.rates)) {
    if (value === null) continue;
    const denominatorMetric =
      COHORT_RATE_DENOMINATORS[rate as keyof typeof COHORT_RATE_DENOMINATORS];
    const denominator = input.counts[denominatorMetric as keyof typeof input.counts];
    if (denominator >= ANALYSIS_THRESHOLDS.minRateDenominator) continue;
    issues.push({
      code: "SAMPLE_TOO_SMALL",
      scope: rate,
      details: {
        denominatorMetric: String(denominatorMetric),
        denominator: String(denominator),
        threshold: String(ANALYSIS_THRESHOLDS.minRateDenominator),
      },
      evidence: [ev(String(denominatorMetric), denominator, "summary")],
    });
  }

  /* -- MIXED_CURRENCY / METRIC_UNAVAILABLE ---------------------------------- */
  if (!input.amount.amountAggregationAvailable) {
    const reason = input.amount.unavailableReason;
    if (reason === "currency_unspecified_or_mixed") {
      issues.push({
        code: "MIXED_CURRENCY",
        scope: "firstDepositAmount",
        details: { reason },
        evidence: [ev("firstDepositAmount.unavailableReason", reason, "availability")],
      });
    } else if (reason !== "no_confirmed_first_deposits") {
      issues.push({
        code: "METRIC_UNAVAILABLE",
        scope: "firstDepositAmount",
        details: { reason: String(reason) },
        evidence: [ev("firstDepositAmount.unavailableReason", String(reason), "availability")],
      });
    }
  }

  /* -- METRIC_UNAVAILABLE: a median broken rather than empty -----------------
   *
   * THE DISTINCTION THIS BRANCH EXISTS TO DRAW. A median with `sampleSize === 0`
   * is normally VALID EMPTINESS — nobody reached that funnel step — and gets no
   * issue at all.
   *
   * But when negative durations were observed, the durations that would have
   * formed the median were EXCLUDED because they ran backwards. The metric is
   * then unavailable because the records are broken, not because the population
   * is empty, and that is a genuine limitation an operator must see.
   */
  for (const [lag, median] of Object.entries(input.medians)) {
    if (median.medianSeconds !== null) continue;
    if (median.negativeDurationCount === 0) continue;
    issues.push({
      code: "METRIC_UNAVAILABLE",
      scope: lag,
      details: {
        sampleSize: String(median.sampleSize),
        negativeDurationCount: String(median.negativeDurationCount),
      },
      evidence: [ev(`${lag}.negativeDurationCount`, median.negativeDurationCount, "summary")],
    });
  }

  /* -- INTEGRITY_WARNING ----------------------------------------------------- */
  if (input.integrity.missingOrDuplicateRegistrationCount > 0) {
    issues.push({
      code: "INTEGRITY_WARNING",
      scope: "registration",
      details: { value: String(input.integrity.missingOrDuplicateRegistrationCount) },
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
    issues.push({
      code: "INTEGRITY_WARNING",
      scope: "firstDeposit",
      details: { value: String(input.integrity.duplicateFirstDepositCount) },
      evidence: [
        ev("duplicateFirstDepositCount", input.integrity.duplicateFirstDepositCount, "integrity"),
      ],
    });
  }

  for (const [lag, median] of Object.entries(input.medians)) {
    if (median.negativeDurationCount === 0) continue;
    issues.push({
      code: "INTEGRITY_WARNING",
      scope: lag,
      details: { negativeDurationCount: String(median.negativeDurationCount) },
      evidence: [ev(`${lag}.negativeDurationCount`, median.negativeDurationCount, "summary")],
    });
  }

  return issues;
}

/* -------------------------------------------------------------- the verdict */

/**
 * `BREAKDOWN_TRUNCATED` is in the catalog and is NOT emitted by this release.
 *
 * Stated here rather than left to be discovered. `analysis-input.ts` calls
 * `loadBreakdown` with no limit, so the analysis reads the COMPLETE breakdown
 * and there is nothing to truncate. The code exists because the catalog is
 * closed and a later phase that paginates the breakdown must have a reviewed
 * code to emit rather than inventing one under time pressure — and because the
 * CRM must already be able to render it.
 *
 * `assertIssueIsCatalogLegal` accepts it; no current input produces it; a test
 * asserts both facts so this comment cannot quietly become false.
 */
export const UNEMITTED_REASON_CODES: readonly SufficiencyReasonCode[] = ["BREAKDOWN_TRUNCATED"];

export class AnalysisSufficiencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisSufficiencyError";
  }
}

/**
 * Refuse an issue that is not in the closed catalog, BEFORE publication.
 *
 * §4: an unknown internal reason code must fail contract rendering rather than
 * reach a consumer. A 500 here is the correct outcome — an operator seeing an
 * unexplained code would be worse than an operator seeing an error.
 */
export function assertIssueIsCatalogLegal(issue: SufficiencyIssue): void {
  if (!(SUFFICIENCY_REASON_CODES as readonly string[]).includes(issue.code)) {
    throw new AnalysisSufficiencyError(
      `sufficiency issue ${issue.code}: not in the closed reason-code catalog`,
    );
  }
  if (issue.evidence.length === 0) {
    throw new AnalysisSufficiencyError(
      `sufficiency issue ${issue.code}: no evidence attached`,
    );
  }
}

/**
 * The issue list for an input, catalog-checked.
 *
 * AN EMPTY PERIOD RAISES NO ISSUES, and that is a deliberate contract decision
 * rather than an oversight. An issue means "a comparison this report would
 * otherwise have made is unavailable". When there is no data at all there is no
 * report to limit: the missing comparison IS the emptiness, and listing
 * `COMPARISON_PERIOD_UNAVAILABLE` beside `insufficient_data` would tell an
 * operator that something went wrong when the honest answer is "nothing
 * happened in this window".
 *
 * This is the same rule §4 states for empty sections, applied to the whole
 * report. The `insufficient_data` FINDING already names why the period was
 * empty, so no information is lost.
 */
export function sufficiencyIssuesOf(input: AnalysisInput): readonly SufficiencyIssue[] {
  if (!hasAnyData(input)) return [];
  const issues =
    input.mode === "event_date" ? eventDateIssues(input) : cohortIssues(input);
  for (const issue of issues) assertIssueIsCatalogLegal(issue);
  return issues;
}

/** Is there anything at all to describe? Delegated to the accepted rules. */
export function hasAnyData(input: AnalysisInput): boolean {
  return input.mode === "event_date" ? eventDateHasData(input) : cohortHasData(input);
}

/**
 * The whole verdict, in one place.
 *
 * `insufficient_data` wins over everything: when there is nothing to describe,
 * the issues are not the story and the report says so and stops. Otherwise any
 * issue at all makes the report `partial`, because a report with an unavailable
 * comparison IS incomplete however small the gap looks.
 */
export function analysisStatusOf(
  input: AnalysisInput,
  issues: readonly SufficiencyIssue[],
): AnalysisStatus {
  if (!hasAnyData(input)) return "insufficient_data";
  return issues.length > 0 ? "partial" : "ok";
}

export function sufficiencyStatusOf(status: AnalysisStatus): SufficiencyStatus {
  if (status === "insufficient_data") return "insufficient";
  if (status === "partial") return "partial";
  return "complete";
}

/**
 * The two statuses answer different questions and must never disagree.
 *
 * Checked at build time rather than trusted, because they are published as two
 * separate fields and a consumer may branch on either. A mismatch is a
 * programming error and fails the request.
 */
export function assertStatusesAgree(
  status: AnalysisStatus,
  sufficiency: SufficiencyStatus,
): void {
  if (sufficiencyStatusOf(status) !== sufficiency) {
    throw new AnalysisSufficiencyError(
      `status ${status} and dataSufficiency.status ${sufficiency} disagree`,
    );
  }
}

/** Build the published sufficiency block. */
export function buildDataSufficiency(
  input: AnalysisInput,
  issues: readonly SufficiencyIssue[],
  status: AnalysisStatus,
): DataSufficiency {
  const sufficiency = sufficiencyStatusOf(status);
  assertStatusesAgree(status, sufficiency);
  return { status: sufficiency, issues };
}
