/**
 * AFD-5D1 — assembling the published report.
 *
 * The one place raw findings become an `AnalysisReport`. It renders through the
 * catalog, groups by section, and builds the overview from values the aggregates
 * already published — it computes nothing of its own.
 */
import {
  ANALYSIS_CATALOG_VERSION,
  ANALYSIS_ENGINE_VERSION,
  ANALYSIS_THRESHOLDS,
  CURIE_ATLAS_AGENT_CODE,
  CURIE_ATLAS_AGENT_VERSION,
  groupBySection,
  type AnalysisOverview,
  type AnalysisReport,
  type Finding,
} from "./analysis-contract";
import { renderFindings } from "./analysis-engine";
import {
  analysisStatusOf,
  buildDataSufficiency,
  sufficiencyIssuesOf,
  type AnalysisStatus,
  type DataSufficiency,
} from "./analysis-sufficiency";
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
      positive_signal: grouped.positiveSignals.length,
      question: grouped.questions.length,
    },
    headlineMetrics,
  };
}

/**
 * Build the report.
 *
 * The agent and the engine are both announced explicitly, including
 * `modelInvoked: false`, so a consumer never has to infer WHO said this or HOW
 * the sentences were produced — and so the day an engine over the same catalog
 * is added, the difference is visible in the payload rather than only in a
 * changelog.
 *
 * `inputFingerprint` is a PARAMETER rather than something computed here, because
 * it is a property of the resolved REQUEST and this function only ever sees the
 * loaded aggregates. Passing it in keeps the one function that knows the request
 * grammar (`analysisInputFingerprint`) as the only place that decides what
 * identifies a question.
 */
export function buildAnalysisReport(
  input: AnalysisInput,
  inputFingerprint: string,
): AnalysisReport {
  const findings = renderFindings(runRules(input));
  const grouped = groupBySection(findings);

  // AFD-5D2A — the verdict is computed HERE, from the same input the rules read.
  // `status` and `dataSufficiency.status` are two views of one decision and
  // cannot disagree: `buildDataSufficiency` asserts that.
  const issues = sufficiencyIssuesOf(input);
  const status: AnalysisStatus = analysisStatusOf(input, issues);
  const dataSufficiency: DataSufficiency = buildDataSufficiency(input, issues, status);

  return {
    status,
    agent: {
      code: CURIE_ATLAS_AGENT_CODE,
      version: CURIE_ATLAS_AGENT_VERSION,
    },
    engine: {
      kind: "deterministic",
      engineVersion: ANALYSIS_ENGINE_VERSION,
      catalogVersion: ANALYSIS_CATALOG_VERSION,
      modelInvoked: false,
    },
    inputFingerprint,
    overview: overviewOf(input, findings),
    dataSufficiency,
    observations: grouped.observations,
    warnings: grouped.warnings,
    positiveSignals: grouped.positiveSignals,
    questions: grouped.questions,
    thresholds: ANALYSIS_THRESHOLDS,
  };
}
