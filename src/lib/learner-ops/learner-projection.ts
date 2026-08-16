/**
 * LEARNER-OPERATIONS-V1 — the LEARNER-FACING projection helpers.
 *
 * WHY THIS FILE EXISTS. Two routes answer a learner about their own cases (the
 * list and one case's thread) and both must project the same facts the same
 * way. Written twice they would drift, and the field most likely to drift is
 * the one that decides what a client is ALLOWED to know. So the shape lives
 * here once, and each route imports it.
 *
 * WHAT MAY BE PROJECTED TO A LEARNER, AND WHY IT IS SAFE.
 * Only the canonical LEVEL COORDINATE of the case's anchor: its number, its
 * stable code and its title. Every one of those is already on the learner's own
 * level page, and the case's subject line already names the level in prose.
 * Projecting the coordinate adds no fact — it only makes the fact machine-
 * readable, so a learner-facing surface can put a mentor's reply beside the
 * level it is about instead of guessing from a string.
 *
 * WHAT MAY NEVER BE PROJECTED, AND WHY EACH ONE IS ABSENT BY CONSTRUCTION.
 *   - the anchor's IDENTITY (`userLevelProgressId`, `reportSubmissionId`).
 *     Nothing learner-facing addresses a progression row directly, so exposing
 *     its id would only invite a client to key on it.
 *   - the anchor's STATUS. A level is completed when the progression owner says
 *     so. An operational case that has been `resolved` is not a completion and
 *     must never be readable as one, so its canonical object's status does not
 *     travel beside it. See LEARNER_OPS_CANONICAL_DECISION_TYPES.
 *   - anything internal: notes, QA, escalations, assignment, queue, priority,
 *     reason codes, SLA clocks. None of them is named in this module, which is
 *     the same defence the routes use — disclosure would require ADDING a field
 *     here, not getting a boolean wrong somewhere.
 */

/** The learner-visible coordinate of the level a review case is anchored to. */
export type LearnerOpsCaseLevel = {
  readonly levelNumber: number;
  readonly stableCode: string;
  readonly title: string;
};

/**
 * The two anchor shapes, as selected by the learner routes. Typed structurally
 * rather than against Prisma's generated payload so a future `select` that
 * quietly widened would not silently type-check here.
 */
export type AnchoredCaseRow = {
  readonly userLevelProgress?: { readonly levelDefinition: LearnerOpsCaseLevel } | null;
  readonly reportSubmission?: { readonly levelDefinition: LearnerOpsCaseLevel } | null;
};

/**
 * The level a case is about, or null when it is about no level at all.
 *
 * `support_request`, `complaint`, `service_recovery` and the rest carry neither
 * anchor and correctly answer null: a support conversation is not a level, and
 * a surface that reads this must not be able to attach one to a level anyway.
 *
 * The two anchors are mutually exclusive by CHECK constraint (migration 51), so
 * the order below is a formality rather than a precedence rule; it is written as
 * an explicit fallback so the function is total for any row shape.
 */
export function learnerOpsCaseLevel(row: AnchoredCaseRow): LearnerOpsCaseLevel | null {
  const anchor = row.userLevelProgress?.levelDefinition ?? row.reportSubmission?.levelDefinition ?? null;
  if (!anchor) return null;
  return {
    levelNumber: anchor.levelNumber,
    stableCode: anchor.stableCode,
    title: anchor.title,
  };
}
