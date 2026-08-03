/**
 * AFD-5D1 — assembling the published report.
 *
 * The one place raw findings become an `AnalysisReport`. It renders through the
 * catalog, groups by section, and builds the overview from values the aggregates
 * already published — it computes nothing of its own.
 */
import {
  ANALYSIS_CATALOG_VERSION,
  ANALYSIS_THRESHOLDS,
  groupBySection,
  INSUFFICIENT_DATA,
  type AnalysisOverview,
  type AnalysisReport,
  type DataSufficiency,
  type Finding,
} from "./analysis-contract";
import { renderFindings } from "./analysis-engine";
import type { AnalysisInput } from "./analysis-input";
import { cohortHasData, eventDateHasData, runRules } from "./analysis-rules";

/** The headline block, copied from the aggregates and never recomputed. */
function overviewOf(input: AnalysisInput, findings: readonly Finding[]): AnalysisOverview {
  const grouped = groupBySection(findings);

  const headlineMetrics: Record<string, string> =
    input.mode === "event_date"
      ? {
          qualifiedClicks: String(input.counts.qualifiedClicks),
          academyRegistrations: String(input.counts.academyRegistrations),
          pocketRegistrations: String(input.counts.pocketRegistrations),
          confirmedFirstDeposits: String(input.counts.confirmedFirstDeposits),
          pendingIdentityDeposits: String(input.counts.pendingIdentityDeposits),
          conflictingDeposits: String(input.counts.conflictingDeposits),
        }
      : {
          cohortLearners: String(input.counts.cohortLearners),
          pocketRegisteredLearners: String(input.counts.pocketRegisteredLearners),
          firstDepositLearners: String(input.counts.firstDepositLearners),
        };

  return {
    mode: input.mode,
    // Cohort reporting is attributed by construction: the population is defined
    // by a frozen acquisition click, so an unattributed learner has no cohort.
    coverage: input.mode === "event_date" ? input.coverage : "attributed",
    filtered: input.filtered,
    breakdownDimension: input.dimension,
    bucketCount: input.buckets.length,
    findingCounts: {
      observation: grouped.observations.length,
      warning: grouped.warnings.length,
      opportunity: grouped.opportunities.length,
      question: grouped.questions.length,
    },
    headlineMetrics,
  };
}

function sufficiencyOf(input: AnalysisInput): DataSufficiency {
  if (input.mode === "event_date") {
    if (eventDateHasData(input)) return { status: "sufficient" };
    return {
      status: INSUFFICIENT_DATA,
      reason: "no_events_in_period",
      evidence: [
        { key: "qualifiedClicks", value: String(input.counts.qualifiedClicks), source: "summary" },
        {
          key: "academyRegistrations",
          value: String(input.counts.academyRegistrations),
          source: "summary",
        },
      ],
    };
  }

  if (cohortHasData(input)) return { status: "sufficient" };
  return {
    status: INSUFFICIENT_DATA,
    reason: "empty_cohort",
    evidence: [
      { key: "cohortLearners", value: String(input.counts.cohortLearners), source: "summary" },
    ],
  };
}

/**
 * Build the report.
 *
 * The engine is announced explicitly, including `modelInvoked: false`, so a
 * consumer never has to infer how the sentences were produced — and so the day
 * an engine over the same catalog is added, the difference is visible in the
 * payload rather than only in a changelog.
 */
export function buildAnalysisReport(input: AnalysisInput): AnalysisReport {
  const findings = renderFindings(runRules(input));
  const grouped = groupBySection(findings);

  return {
    engine: {
      kind: "deterministic",
      catalogVersion: ANALYSIS_CATALOG_VERSION,
      modelInvoked: false,
    },
    overview: overviewOf(input, findings),
    dataSufficiency: sufficiencyOf(input),
    observations: grouped.observations,
    warnings: grouped.warnings,
    opportunities: grouped.opportunities,
    questions: grouped.questions,
    thresholds: ANALYSIS_THRESHOLDS,
  };
}
