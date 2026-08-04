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

import type { FindingComparison, SupportTier } from "./analysis-support";
import type { AnalysisStatus, DataSufficiency } from "./analysis-sufficiency";
export type { FindingComparison, SupportTier };
export type { AnalysisStatus };

/* ------------------------------------------------------------------- modes */

/** The two reporting modes, matching the accepted analytics routes exactly. */
export const ANALYSIS_MODES = ["event_date", "acquisition_cohort"] as const;
export type AnalysisMode = (typeof ANALYSIS_MODES)[number];

export const ANALYSIS_SECTIONS = [
  "observation",
  "warning",
  "positive_signal",
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

  /* ---- positive signals: measured differences, stated without advice -- */
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
  /**
   * AFD-5D2A — how well-supported this finding is, decided HERE.
   *
   * Previously the CRM had no such value and could only have invented one from
   * a denominator it would have had to find itself. It is computed from the
   * finding's own operands and the published thresholds — see
   * `analysis-support.ts`.
   */
  readonly supportTier: SupportTier;
  /**
   * AFD-5D2A — the structured comparison, when this finding is one.
   *
   * `null` for the majority of findings, which state a value rather than a
   * change. Every number in it was already computed by the rules; nothing here
   * is derived in a consumer.
   */
  readonly comparison: FindingComparison | null;
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
  /**
   * AFD-5D2A — the denominator at or above which a rate-bearing finding is
   * published as `strong` support.
   *
   * THIS IS THE ONE NEW NUMBER IN THE PHASE, and it is stated plainly rather
   * than buried. Three support tiers need two boundaries; the catalog already
   * had exactly one (`minRateDenominator`), so the upper boundary had to be
   * introduced or the third tier would have been unreachable.
   *
   * IT IS A REPORTING CONVENTION, NOT A STATISTICAL CLAIM. It says "at this many
   * observations the report is willing to call the rate well-supported"; it does
   * not compute a confidence interval, a significance level or a power estimate,
   * and nothing in this phase does. Like every other threshold here it is
   * PUBLISHED in `thresholds`, so a reader can see the rule that produced the
   * label without reading source, and a later phase can move it under review.
   */
  strongSupportMinDenominator: 100,
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
 * The sufficiency verdict — REDEFINED BY AFD-5D2A.
 *
 * It was a two-branch union (`sufficient` | `insufficient_data` + one reason).
 * That shape could not express "this report is real but one comparison is
 * missing", which is why AFD-5D2's CRM ended up deriving a `partial` state in
 * the browser. The verdict now lives in `analysis-sufficiency.ts` and carries a
 * three-valued status plus a list of coded issues.
 *
 * `INSUFFICIENCY_REASONS` above is kept because the `insufficient_data` FINDING
 * still names why the period was empty; it is not the sufficiency contract.
 */
export type { DataSufficiency, SufficiencyIssue } from "./analysis-sufficiency";

/* ----------------------------------------------------------------- agent */

/**
 * WHO produced this report, as distinct from HOW.
 *
 * PRODUCT-RC-1 publishes this because "the analysis endpoint" is about to stop
 * being the only agent. `curie_pulse`, `curie_mentor` and `curie_sentinel` will
 * answer on their own routes with their own catalogs, and a consumer that stored
 * a report needs to know which agent said it without inferring that from a URL
 * it may no longer have.
 *
 * The code is a STABLE IDENTITY, not a display name: it may be added to, never
 * repurposed. The version moves when the published contract or the catalog's
 * meaning moves — it is the agent's public semver, and it is deliberately
 * separate from the engine and catalog versions below, because an agent can keep
 * its promise across an engine swap.
 */
export const CURIE_ATLAS_AGENT_CODE = "curie_atlas" as const;

/**
 * 1.0.0 — the first published contract.
 *
 * This is the version at which `positiveSignals` (not `opportunities`) is the
 * name of the third collection. Nothing consumed the pre-normalization shape;
 * there is no 0.x to be compatible with, and no alias is published.
 */
export const CURIE_ATLAS_AGENT_VERSION = "1.0.0";

export type AgentDescriptor = {
  readonly code: typeof CURIE_ATLAS_AGENT_CODE;
  readonly version: string;
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
 *
 * THREE VERSIONS, THREE THINGS. They move independently and a reader must be
 * able to tell which one moved:
 *
 *   - `agent.version`   — the published contract this report obeys;
 *   - `engineVersion`   — the implementation that turned inputs into findings;
 *   - `catalogVersion`  — the closed set of codes and sentence templates.
 *
 * Collapsing them into one number would mean a rule-ordering fix and a new
 * finding code were indistinguishable to a consumer deciding whether its stored
 * reports are still comparable.
 */
export type EngineDescriptor = {
  readonly kind: "deterministic";
  readonly engineVersion: string;
  readonly catalogVersion: string;
  readonly modelInvoked: false;
};

/**
 * The deterministic rule implementation's own version.
 *
 * Bump this when the RULES change — a threshold comparison, an ordering, a
 * rounding — even if every code and template stays identical. Two reports with
 * the same catalog version but different engine versions may legitimately differ.
 */
export const ANALYSIS_ENGINE_VERSION = "1.0.0";

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
  /**
   * AFD-5D2A — the one word an operator acts on, decided by the BACKEND.
   *
   * `ok` — read it. `partial` — read the issues first. `insufficient_data` —
   * there is nothing here to read. It is first in the type because it is first
   * in the reader's decision, and because a consumer that branches on nothing
   * else must still branch on this.
   */
  readonly status: AnalysisStatus;
  readonly agent: AgentDescriptor;
  readonly engine: EngineDescriptor;
  /**
   * A stable hash of the RESOLVED request — the window, cutoff, filters,
   * grouping and dimension as the server understood them, not as the caller
   * spelled them.
   *
   * RESOLVED, NOT RAW, on purpose. `preset: "last_30_days"` and the explicit
   * custom dates it resolves to are the same question, and two operators
   * comparing reports need them to fingerprint the same. Conversely the same raw
   * body sent on two different days resolves to two different windows and must
   * NOT collide.
   *
   * It is not a cache key and not a secret: it carries no id an unauthorised
   * caller could not already supply, and it is truncated far below any preimage
   * concern. Its only job is to let a consumer answer "is this the same question
   * I asked before" without diffing a nested object.
   */
  readonly inputFingerprint: string;
  readonly overview: AnalysisOverview;
  readonly dataSufficiency: DataSufficiency;
  readonly observations: readonly Finding[];
  readonly warnings: readonly Finding[];
  readonly positiveSignals: readonly Finding[];
  readonly questions: readonly Finding[];
  readonly thresholds: AnalysisThresholds;
};

/* ------------------------------------------------------- section grouping */

/** Split a flat, already-rendered list into the four published sections. */
export function groupBySection(findings: readonly Finding[]): {
  observations: Finding[];
  warnings: Finding[];
  positiveSignals: Finding[];
  questions: Finding[];
} {
  return {
    observations: findings.filter((finding) => finding.section === "observation"),
    warnings: findings.filter((finding) => finding.section === "warning"),
    positiveSignals: findings.filter((finding) => finding.section === "positive_signal"),
    questions: findings.filter((finding) => finding.section === "question"),
  };
}
