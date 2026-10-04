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

/**
 * The methods a published curriculum declares.
 *
 * Six came with the 100-level program. The 30-level program (2026-10-02) adds
 * two that the Backend has an owner for and this build had no surface for:
 *
 *   lesson:lesson        a lesson with NO test — the learner watches it and
 *                        says so. Same Backend command as `manual`, different
 *                        thing being declared («урок пройден», not «практика
 *                        выполнена»), so it gets its own member and wording.
 *   report:formal_check  a report nobody reviews — the platform accepts it at
 *                        submission when the required fields are filled. Kept
 *                        apart from `report` because every sentence written for
 *                        `report` names a mentor, and here there is none.
 */
export type BackendCompletionMethod =
  | "pocket_postback"
  | "assessment_pass"
  | "report_approval"
  | "formal_check"
  | "balance_check"
  | "manual"
  | "lesson"
  | "mentor_review";

export type AcademyCompletionMethod =
  | "external-event"
  | "assessment"
  | "report"
  | "formal-report"
  | "checkpoint"
  | "manual"
  | "lesson"
  | "mentor-review"
  | "unsupported";

const MAP: Record<BackendCompletionMethod, AcademyCompletionMethod> = {
  pocket_postback: "external-event",
  assessment_pass: "assessment",
  report_approval: "report",
  formal_check: "formal-report",
  balance_check: "checkpoint",
  manual: "manual",
  lesson: "lesson",
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
  "formal-report": "Отчёт, проверка автоматическая",
  checkpoint: "Контрольная точка",
  manual: "Самостоятельно",
  lesson: "Просмотр урока",
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
/**
 * LESSON HI-FI (DD-336) — the method as a FACT under a level's title.
 *
 * The table of parameters under a lesson is gone; what it said is one line of
 * facts beside the title, worded for a learner reading what the level asks of
 * them rather than naming a mechanism («Внешнее событие» was the table's word
 * for registering in Pocket). One vocabulary, kept here beside the labels; null
 * where a method is not known, so nothing is guessed.
 */
export const COMPLETION_METHOD_FACT: Record<AcademyCompletionMethod, string | null> = {
  "external-event": "регистрация в Pocket",
  // «Проверка знаний» everywhere (2026-10-04, launch audit): the same thing was
  // «тест», «проверка понимания» and «проверка знаний» on three screens.
  assessment: "проверка знаний после урока",
  report: "отчёт · проверяет наставник",
  "formal-report": "отчёт · проверка автоматическая",
  checkpoint: "контрольная точка",
  manual: "задание · отмечаете сами",
  lesson: "урок без проверки знаний",
  "mentor-review": "работа наставнику",
  unsupported: null,
};

/** The fact a level's method reads as under its title; null for an unknown one. */
export function completionMethodFact(method: string | null | undefined): string | null {
  if (typeof method === "string" && method in COMPLETION_METHOD_FACT) {
    return COMPLETION_METHOD_FACT[method as AcademyCompletionMethod];
  }
  return null;
}

export function completionMethodLabel(method: string | null | undefined): string {
  if (typeof method === "string" && method in COMPLETION_METHOD_LABEL) {
    return COMPLETION_METHOD_LABEL[method as AcademyCompletionMethod];
  }
  return COMPLETION_METHOD_LABEL.unsupported;
}

export function isManualCompletionMethod(method: AcademyCompletionMethod): boolean {
  return method === "manual";
}

/**
 * Is the level closed by the learner's own declaration?
 *
 * Two methods, one Backend command (`POST …/complete`): a practical step the
 * learner did (`manual`) and a lesson without a test the learner watched
 * (`lesson`). The surface is the same control with different words.
 */
export function isSelfDeclaredCompletionMethod(method: AcademyCompletionMethod): boolean {
  return method === "manual" || method === "lesson";
}

/**
 * Is the level a report — reviewed by a person or accepted by the platform?
 *
 * Both share the form, the drafts and the revisions. What differs is who says
 * yes, and every sentence that names that someone must ask
 * `isFormalReportMethod` first.
 */
export function isReportCompletionMethod(method: AcademyCompletionMethod): boolean {
  return method === "report" || method === "formal-report";
}

export function isFormalReportMethod(method: AcademyCompletionMethod): boolean {
  return method === "formal-report";
}
