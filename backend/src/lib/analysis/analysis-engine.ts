/**
 * AFD-5D1 — the engine seam, and the gate every finding passes through.
 *
 * THE SEAM. `AnalysisEngine` is the one interface the route depends on. This
 * phase ships exactly one implementation, `deterministicEngine`, which reads the
 * accepted aggregates and applies the rules in `analysis-rules.ts`. NO MODEL IS
 * CALLED, no key is read and no request leaves the process.
 *
 * A later phase may add a second implementation over the SAME catalog. It would
 * receive the same `AnalysisInput` and return the same `RawFinding[]`, so it
 * could re-order, select or suppress findings — and could not invent one,
 * because a `RawFinding` carries a `FindingCode` from the closed union and its
 * sentence is produced by the catalog. The endpoint, the published JSON schema
 * and the analytics calculations do not change when that happens.
 *
 * THE GATE. `renderFindings` refuses any finding whose code is unknown, whose
 * required operands are incomplete, or which carries no evidence. That last rule
 * is the one that matters most: a sentence with numbers in it must be traceable
 * to an input aggregate, and a rule that forgot to attach its operands fails
 * loudly here rather than publishing an unsourced claim.
 */
import { ANALYSIS_CATALOG } from "./analysis-catalog";
import {
  type AnalysisMode,
  type Finding,
  type FindingCode,
  type RawFinding,
} from "./analysis-contract";
import type { AnalysisInput } from "./analysis-input";
import { comparisonOf, supportTierOf } from "./analysis-support";

/**
 * The contract a findings producer must satisfy.
 *
 * It returns RAW findings — codes and operands — never rendered prose. That is
 * what keeps the catalog the single source of every sentence regardless of which
 * implementation is installed.
 */
export interface AnalysisEngine {
  readonly kind: "deterministic";
  analyze(input: AnalysisInput): readonly RawFinding[];
}

export class AnalysisFindingError extends Error {}

/** Is this a member of the closed catalog? */
export function isKnownFindingCode(code: string): code is FindingCode {
  return Object.prototype.hasOwnProperty.call(ANALYSIS_CATALOG, code);
}

/**
 * Validate one raw finding against the catalog.
 *
 * Exported so a future engine can be checked with exactly the same gate the
 * deterministic one passes, rather than a looser one written for it.
 */
export function assertFindingIsCatalogLegal(finding: RawFinding): void {
  if (!isKnownFindingCode(finding.code)) {
    throw new AnalysisFindingError(`unknown finding code: ${String(finding.code)}`);
  }
  const entry = ANALYSIS_CATALOG[finding.code];

  for (const key of entry.requiredOperands) {
    const value = finding.operands[key];
    if (value === undefined || value === "") {
      throw new AnalysisFindingError(`finding ${finding.code}: missing operand "${key}"`);
    }
  }

  // EVERY finding must be traceable to an input aggregate. The standing
  // `question_*` entries are the sole exception: they state what the report
  // cannot answer, so they quote no measurement — and they take no operands
  // either, which is what distinguishes them structurally.
  if (finding.evidence.length === 0 && entry.section !== "question") {
    throw new AnalysisFindingError(`finding ${finding.code}: no evidence attached`);
  }
}

/** Render raw findings into published ones, refusing anything illegal. */
export function renderFindings(raw: readonly RawFinding[]): Finding[] {
  return raw.map((finding) => {
    assertFindingIsCatalogLegal(finding);
    const entry = ANALYSIS_CATALOG[finding.code];
    return {
      code: finding.code,
      section: entry.section,
      severity: entry.severity,
      message: entry.render(finding.operands),
      evidence: finding.evidence,
      dimensionId: finding.dimensionId ?? null,
      // AFD-5D2A — both decided HERE, from the finding's own operands and the
      // published thresholds. A consumer renders them and never recomputes them.
      supportTier: supportTierOf(finding),
      comparison: comparisonOf(finding),
    };
  });
}

/** The modes the deterministic engine understands. */
export function supportsMode(mode: AnalysisMode): boolean {
  return mode === "event_date" || mode === "acquisition_cohort";
}
