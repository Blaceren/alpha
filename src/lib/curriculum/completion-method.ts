/**
 * G3 — Backend `LevelDefinition.completionMethod` -> Academy display concept.
 *
 * WHY THIS EXISTS
 * `mapLevelType` answers "what KIND of level is this?" and that is not enough to
 * decide what the page must offer. Two very different levels are both `lesson`:
 *
 *   lesson:assessment_pass — 58 levels, finished by a graded check
 *   lesson:manual          — 13 canonical practical levels, finished by an
 *                            explicit learner declaration
 *
 * Before this mapper the page rendered the assessment surface for both, so a
 * practical level showed a check that did not exist and offered no way to
 * finish at all.
 *
 * EXHAUSTIVE AND FAIL-CLOSED, exactly like `level-type.ts`. An unrecognised
 * method maps to `unsupported`, which selects NO completion surface — the same
 * degradation an unknown level type gets. A method this build does not
 * understand must never be presented as one it does.
 *
 * PRESENTATION ONLY. This decides which surface is rendered. It never decides
 * whether a completion is permitted: the Backend owner does that, and refuses
 * anything else whatever this page offers.
 */

/** The six methods the canonical v4 curriculum actually declares. */
export type BackendCompletionMethod =
  | "pocket_postback"
  | "assessment_pass"
  | "report_approval"
  | "balance_check"
  | "manual"
  | "mentor_review";

export type AcademyCompletionMethod =
  | "external-event"
  | "assessment"
  | "report"
  | "checkpoint"
  | "manual"
  | "mentor-review"
  | "unsupported";

const MAP: Record<BackendCompletionMethod, AcademyCompletionMethod> = {
  pocket_postback: "external-event",
  assessment_pass: "assessment",
  report_approval: "report",
  balance_check: "checkpoint",
  manual: "manual",
  mentor_review: "mentor-review",
};

export function mapCompletionMethod(method: string): AcademyCompletionMethod {
  return (MAP as Record<string, AcademyCompletionMethod>)[method] ?? "unsupported";
}

/**
 * Does this method complete through an explicit learner declaration?
 *
 * True for exactly one method. Kept as a named predicate rather than an inline
 * comparison so the one place that decides "offer the manual control" is
 * greppable, and so widening it is a deliberate edit rather than a typo.
 */
/**
 * ATA-COMPLETION-TRUTH-1B — how a level gets closed, said in the learner's
 * language, keyed on the METHOD.
 *
 * WHY THIS EXISTS BESIDE `completion-source.ts`. That module localised an
 * internal enum that was reaching the screen, and it did the right thing at the
 * time: it mapped nine `AcademyLevelType`s onto six sources. But a level's TYPE
 * is not how it is closed. `report_approval` and `mentor_review` are two
 * different methods that both live on report-shaped work, so a type-derived
 * label called them both «Проверка ментором» — and L3, whose method is
 * `report_approval`, told the learner a mentor decides it.
 *
 * The method has travelled in the summary since G3 (`AcademyLevelSummary
 * .completionMethod`), already normalised and already fail-closed: anything the
 * build does not know becomes `unsupported`. So this adds a label for the value
 * that was always there rather than a new field, and `CompletionSource` keeps
 * its own meaning untouched.
 *
 * FAIL-CLOSED, AND NEVER GUESSED FROM THE TYPE. An unknown or missing method
 * gets «Не определён» — the same neutral wording the source map already uses.
 * Guessing «Проверка ментором» from a report-shaped level is precisely the
 * defect this closes, so no fallback here may consult the type.
 */
export const COMPLETION_METHOD_LABEL: Record<AcademyCompletionMethod, string> = {
  "external-event": "Внешнее событие",
  assessment: "Проверка знаний",
  report: "Одобрение отчёта",
  checkpoint: "Контрольная точка",
  manual: "Самостоятельно",
  "mentor-review": "Проверка ментором",
  unsupported: "Не определён",
};

/**
 * The learner-facing label for a completion method.
 *
 * Accepts a loose value because the field is a string on the wire; anything not
 * in the closed vocabulary above resolves to the neutral copy rather than being
 * echoed or inferred.
 */
export function completionMethodLabel(method: string | null | undefined): string {
  if (typeof method === "string" && method in COMPLETION_METHOD_LABEL) {
    return COMPLETION_METHOD_LABEL[method as AcademyCompletionMethod];
  }
  return COMPLETION_METHOD_LABEL.unsupported;
}

export function isManualCompletionMethod(method: AcademyCompletionMethod): boolean {
  return method === "manual";
}
