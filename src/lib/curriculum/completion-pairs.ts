/**
 * PHASE-A — the completion-pair vocabulary, in one dependency-free place.
 *
 * A "pair" is `${LevelDefinition.type}:${LevelDefinition.completionMethod}`. It
 * is the whole of what decides which owner may complete a level, so it used to
 * be worth reading twice that the vocabulary lived ONLY inside
 * `completion.ts` — a module that imports Prisma, the env contract and the XP
 * ledger. Package validation cannot import any of that (validating a JSON file
 * must not open a database client), so before this module the package validator
 * simply did not know which pairs had an owner, and a package could declare a
 * level nothing on the platform was able to complete.
 *
 * This file therefore holds the vocabulary and NOTHING else: no Prisma, no env,
 * no side effects. `completion.ts` builds its OWNER_RULES from it, so there is
 * exactly one list and a package can be checked against the same one the
 * runtime enforces.
 *
 * Adding a pair here does NOT create an owner. `completion.ts` still has to give
 * it an `initialStatus` and, where the pair carries external trust, a proof
 * assertion. This is the vocabulary, not the authorization.
 */

/** `${LevelDefinition.type}:${LevelDefinition.completionMethod}`. */
export type CurriculumCompletionPair = string;

export function completionPair(type: string, completionMethod: string): CurriculumCompletionPair {
  return `${type}:${completionMethod}`;
}

/**
 * The production owners. Every entry is a pair some shipped owner can complete
 * in any environment, including production.
 *
 * `level_completion` owns BOTH `lesson:lesson` and `lesson:manual` (product
 * decision R1): the 13 canonical practical levels that carry no mentor review
 * are `lesson:manual`, completed by an explicit learner action against real
 * instructional content. There is deliberately no `practice:*` pair — a level
 * type with no owner is a level no one can finish.
 */
export const PRODUCTION_COMPLETION_PAIRS = {
  level_completion: ["lesson:lesson", "lesson:manual"],
  assessment_pass: ["lesson:assessment_pass", "final_exam:assessment_pass"],
  report_approval: ["report:report_approval"],
  mentor_completion: ["mentor_review:mentor_review"],
  checkpoint_verification: ["financial_checkpoint:balance_check"],
  pocket_registration_postback: ["external_event:pocket_postback"],
} as const satisfies Record<string, readonly CurriculumCompletionPair[]>;

/**
 * A8 — the STAGING-ONLY attestation owners.
 *
 * They target pairs production already owns, and they do NOT widen what a
 * package may declare: a package still says `external_event:pocket_postback`,
 * and production still completes it from an authenticated Pocket postback. The
 * only thing these owners change is WHO may witness the event on a deployment
 * that is authoritatively classified `staging` — see
 * `src/lib/curriculum/staging-attestation.ts`, which is where the environment
 * gate, the operator authorization and the durable audit live.
 *
 * Kept in a separate constant from the production owners so that "which pairs
 * may a package declare?" and "which owners exist in this deployment?" can
 * never be answered by the same list by accident.
 */
export const STAGING_ATTESTED_COMPLETION_PAIRS = {
  staging_attested_registration: ["external_event:pocket_postback"],
  staging_attested_checkpoint: ["financial_checkpoint:balance_check"],
} as const satisfies Record<string, readonly CurriculumCompletionPair[]>;

/**
 * Every pair a published package may legally declare.
 *
 * Built from the PRODUCTION owners only. A pair that exists solely because a
 * staging attestation could witness it is not a pair a curriculum may ship.
 */
export const OWNED_COMPLETION_PAIRS: ReadonlySet<CurriculumCompletionPair> = new Set(
  Object.values(PRODUCTION_COMPLETION_PAIRS).flat(),
);

/** Does any production owner exist for this level's declared pair? */
export function isOwnedCompletionPair(type: string, completionMethod: string): boolean {
  return OWNED_COMPLETION_PAIRS.has(completionPair(type, completionMethod));
}
