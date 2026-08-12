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
export function isManualCompletionMethod(method: AcademyCompletionMethod): boolean {
  return method === "manual";
}
