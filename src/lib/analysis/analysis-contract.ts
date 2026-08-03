/**
 * AFD-5D1 — the closed contract for the affiliate analysis report.
 *
 * WHAT THIS PHASE IS. A reporting layer over the ALREADY-COMPUTED AFD-5B1 and
 * AFD-5B2A aggregates. It adds no metric, no query and no migration: every
 * number it prints was produced by `summary`, `timeseries` or `breakdown` and is
 * carried into the response as evidence beside the sentence that mentions it.
 *
 * WHAT MAKES THE PROHIBITIONS ENFORCEABLE RATHER THAN ASPIRATIONAL. A finding is
 * not free text. It is a `FindingCode` from the closed catalog below plus a set
 * of operands, and the Russian sentence is produced by the catalog's own
 * template for that code. There is no field on a finding that a caller — today's
 * deterministic engine, or a model added later over the same catalog — can fill
 * with prose. So "no invented causes", "no forecasts", "no advice on rates or
 * CPA" and "no traffic-quality judgement" are properties of a fixed, reviewable
 * list of sentences, not properties of a prompt anybody could edit.
 *
 * The catalog is additionally guarded by a lexicon test that fails the build if
 * any rendered sentence acquires a causal, predictive or advisory word.
 *
 * WHAT IS DELIBERATELY ABSENT: any lead, any email, any User id, any Pocket or
 * click identifier, any reveal capability, any recommendation, any forecast, any
 * traffic-quality score, any statement of cause.
 */

/* ------------------------------------------------------------------- modes */

/** The two reporting modes, matching the accepted analytics routes exactly. */
export const ANALYSIS_MODES = ["event_date", "acquisition_cohort"] as const;
export type AnalysisMode = (typeof ANALYSIS_MODES)[number];

export const ANALYSIS_SECTIONS = [
  "observation",
  "warning",
  "opportunity",
  "question",
] as const;
export type AnalysisSection = (typeof ANALYSIS_SECTIONS)[number];

/**
 * Two levels only.
 *
 * There is no "critical", because a severity ladder invites a judgement this
 * report is not entitled to make. `attention` means "a stored value says this
 * needs a human look"; it never means "this is bad".
 */
export const FINDING_SEVERITIES = ["info", "attention"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/** Which accepted aggregate produced a finding's evidence. */
export const EVIDENCE_SOURCES = [
  "summary",
  "timeseries",
  "breakdown",
  "availability",
  "integrity",
  "period",
] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/* ------------------------------------------------------------------ codes */

/**
 * The COMPLETE catalog of things this report can say.
 *
 * A code is a stable, machine-readable identifier: a consumer may branch on it,
 * and a later phase may add a member but may never repurpose one. Nothing
 * outside this union can reach a response, which is the whole safety argument of
 * the phase.
 */
export const FINDING_CODES = [
  /* ---- observations: levels ------------------------------------------ */
  "period_volume",
  "funnel_rate_level",
  "funnel_rate_undefined",
  "coverage_split",
  "cohort_size",
  "cohort_rate_level",
  "cohort_rate_undefined",
  "cohort_median_lag",
  "cohort_median_unavailable",

  /* ---- observations: measured change between the series endpoints ----- */
  "series_count_change",
  "series_rate_change",
  "series_flat",

  /* ---- observations: composition -------------------------------------- */
  "breakdown_member_count",
  "breakdown_concentration",

  /* ---- warnings: stored values that need a human look ----------------- */
  "conflicting_deposits_present",
  "pending_identity_deposits_present",
  "amount_aggregation_unavailable",
  "series_reconciliation_mismatch",
  "small_sample_rate",
  "negative_duration_observed",
  "cohort_missing_or_duplicate_registration",
  "cohort_duplicate_first_deposit",
  "cohort_cutoff_clamped",

  /* ---- opportunities: measured differences, stated without advice ----- */
  "member_clicks_without_registrations",
  "member_registrations_without_deposits",
  "member_rate_differs_from_aggregate",

  /* ---- questions: what this report cannot answer ---------------------- */
  "question_cause_not_available",
  "question_forecast_not_available",
  "question_traffic_quality_not_available",
  "question_redeposits_unavailable",
  "question_current_balance_unavailable",
  "question_education_timeline_unavailable",

  /* ---- insufficiency --------------------------------------------------- */
  "insufficient_data",
] as const;
export type FindingCode = (typeof FINDING_CODES)[number];

/* --------------------------------------------------------------- evidence */

/**
 * One operand, carrying the value AND where it came from.
 *
 * EVERY FINDING MUST CARRY AT LEAST ONE. A sentence whose numbers cannot be
 * traced back to an input aggregate is exactly the fabrication this phase
 * exists to prevent, so the engine refuses to emit one — see
 * `assertFindingIsCatalogLegal`.
 *
 * `value` is a string even for counts: analytics ratios are already exact
 * decimal strings, and rendering everything through one type keeps a count and a
 * rate from being formatted by two different rules.
 */
export type Evidence = {
  /** The metric or field name as the accepted aggregates spell it. */
  readonly key: string;
  readonly value: string;
  readonly source: EvidenceSource;
  /** The dimension member this operand belongs to, when it belongs to one. */
  readonly dimensionId?: number;
};

/* --------------------------------------------------------------- findings */

/** What a rule (or, later, a model) hands to the catalog. */
export type RawFinding = {
  readonly code: FindingCode;
  readonly operands: Readonly<Record<string, string>>;
  readonly evidence: readonly Evidence[];
  /** Present only on findings that describe one breakdown member. */
  readonly dimensionId?: number;
};

/** What reaches the response. `message` comes from the catalog, never a caller. */
export type Finding = {
  readonly code: FindingCode;
  readonly section: AnalysisSection;
  readonly severity: FindingSeverity;
  readonly message: string;
  readonly evidence: readonly Evidence[];
  readonly dimensionId: number | null;
};

/* ------------------------------------------------------------- thresholds */

/**
 * Every threshold a rule consults, published in the response.
 *
 * A reader must be able to see WHY a finding fired without reading the source,
 * and a threshold that lives only in code is a number nobody can audit. These
 * are conventions for when a fact is worth printing — they are not judgements
 * about whether a number is good.
 */
export const ANALYSIS_THRESHOLDS = {
  /** Below this denominator a rate is reported WITH a small-sample warning. */
  minRateDenominator: 30,
  /** A series endpoint change is printed at or above this relative move. */
  seriesCountChangeMinRelativePercent: "20",
  /** A rate change is printed at or above this move in percentage points. */
  seriesRateChangeMinPoints: "5",
  /** A member needs at least this many qualified clicks to be contrasted. */
  memberMinQualifiedClicks: 50,
  /** A member needs at least this many Pocket registrations to be contrasted. */
  memberMinPocketRegistrations: 20,
  /** A member rate is contrasted with the aggregate at or above this gap. */
  memberRateDifferenceMinPoints: "10",
  /** A single member holding at least this share is reported as concentration. */
  concentrationSharePercent: "60",
} as const;

export type AnalysisThresholds = typeof ANALYSIS_THRESHOLDS;

/* ------------------------------------------------------------ sufficiency */

export const INSUFFICIENT_DATA = "insufficient_data" as const;

export const INSUFFICIENCY_REASONS = [
  "no_events_in_period",
  "empty_cohort",
] as const;
export type InsufficiencyReason = (typeof INSUFFICIENCY_REASONS)[number];

/**
 * The sufficiency verdict.
 *
 * WHEN IT IS `insufficient_data`, THE REPORT STAYS SILENT rather than
 * speculating: `observations` and `opportunities` are empty, and only the
 * insufficiency finding and the standing `questions` remain. Printing "0 %" and
 * "no change" over an empty period would be a description of nothing, offered in
 * the shape of a description of something.
 */
export type DataSufficiency =
  | { readonly status: "sufficient" }
  | {
      readonly status: typeof INSUFFICIENT_DATA;
      readonly reason: InsufficiencyReason;
      readonly evidence: readonly Evidence[];
    };

/* ---------------------------------------------------------------- engine */

/**
 * How the findings were produced.
 *
 * `kind` is published so a consumer never has to guess. In this phase it is
 * always `deterministic`: no model is called, no key is read and no request
 * leaves the process. A later phase may add an engine over the SAME catalog, and
 * it will announce itself here — the endpoint, the JSON schema and the analytics
 * calculations do not change when it does.
 */
export type EngineDescriptor = {
  readonly kind: "deterministic";
  readonly catalogVersion: string;
  readonly modelInvoked: false;
};

export const ANALYSIS_CATALOG_VERSION = "afd5d1.1";

/* --------------------------------------------------------------- overview */

/**
 * The headline block: the shape of the request and the totals it resolved to.
 *
 * Every number here is copied from an accepted aggregate. There is no score, no
 * grade, no index and no composite — a single "health number" would be a
 * judgement dressed as a measurement.
 */
export type AnalysisOverview = {
  readonly mode: AnalysisMode;
  readonly coverage: "attributed" | "unattributed" | "total";
  readonly filtered: boolean;
  readonly breakdownDimension: string;
  readonly bucketCount: number;
  readonly findingCounts: Readonly<Record<AnalysisSection, number>>;
  /** Metric name → exact value, straight from the summary. */
  readonly headlineMetrics: Readonly<Record<string, string>>;
};

/* --------------------------------------------------------------- response */

export type AnalysisReport = {
  readonly engine: EngineDescriptor;
  readonly overview: AnalysisOverview;
  readonly dataSufficiency: DataSufficiency;
  readonly observations: readonly Finding[];
  readonly warnings: readonly Finding[];
  readonly opportunities: readonly Finding[];
  readonly questions: readonly Finding[];
  readonly thresholds: AnalysisThresholds;
};

/* ------------------------------------------------------- section grouping */

/** Split a flat, already-rendered list into the four published sections. */
export function groupBySection(findings: readonly Finding[]): {
  observations: Finding[];
  warnings: Finding[];
  opportunities: Finding[];
  questions: Finding[];
} {
  return {
    observations: findings.filter((finding) => finding.section === "observation"),
    warnings: findings.filter((finding) => finding.section === "warning"),
    opportunities: findings.filter((finding) => finding.section === "opportunity"),
    questions: findings.filter((finding) => finding.section === "question"),
  };
}
