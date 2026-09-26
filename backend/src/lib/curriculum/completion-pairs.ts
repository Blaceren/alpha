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

/* ------------------------------------------------------------------------ */
/* Zero-reward owners                                                        */
/* ------------------------------------------------------------------------ */

/**
 * The owners that can NEVER award XP, whatever a level definition says.
 *
 * These are the GATES. A gate is not a piece of work the learner did, it is a
 * fact about the world the platform waited for — a Pocket registration it
 * authenticated, a balance a provider reported — so there is nothing to reward
 * and `completion.ts` refuses a non-zero reward on one outright
 * (`COMPLETION_REWARD_INVALID`). They are also, not coincidentally, the owners
 * that are absent from `CurriculumXpSourceType` and from the
 * `XPTransaction.sourceType` CHECK constraint, so an XP row for one is
 * impossible at three independent layers.
 *
 * The learner-driven owners are deliberately NOT here. `level_completion`,
 * `assessment_pass`, `report_approval` and `mentor_completion` may all legally
 * carry a positive reward; they simply are not required to.
 */
export const ZERO_REWARD_ONLY_PRODUCTION_OWNERS = [
  "checkpoint_verification",
  "pocket_registration_postback",
] as const satisfies readonly (keyof typeof PRODUCTION_COMPLETION_PAIRS)[];

/**
 * A8 — the staging owners stand in for exactly those gates, so they inherit the
 * rule. Listed separately for the same reason the pair maps are separate: what
 * a PACKAGE may declare and what OWNERS exist in a deployment are two
 * questions that must never be answered from one list by accident.
 */
export const ZERO_REWARD_ONLY_STAGING_OWNERS = [
  "staging_attested_registration",
  "staging_attested_checkpoint",
] as const satisfies readonly (keyof typeof STAGING_ATTESTED_COMPLETION_PAIRS)[];

/**
 * Every zero-reward owner name, production and staging.
 *
 * `completion.ts` builds its runtime predicate from this set rather than
 * repeating the names, so "which owners award nothing" has exactly one answer
 * and the package validator below cannot drift away from the engine.
 */
export const ZERO_REWARD_ONLY_OWNERS: ReadonlySet<string> = new Set<string>([
  ...ZERO_REWARD_ONLY_PRODUCTION_OWNERS,
  ...ZERO_REWARD_ONLY_STAGING_OWNERS,
]);

/**
 * The pairs a package may declare that complete through a zero-reward owner.
 *
 * Built from the PRODUCTION owners only, exactly like `OWNED_COMPLETION_PAIRS`:
 * the staging owners target the same two pairs, so including them would change
 * nothing today and would quietly widen this rule the moment a staging-only
 * pair ever existed.
 */
export const ZERO_REWARD_COMPLETION_PAIRS: ReadonlySet<CurriculumCompletionPair> =
  new Set(
    ZERO_REWARD_ONLY_PRODUCTION_OWNERS.flatMap(
      (owner) => PRODUCTION_COMPLETION_PAIRS[owner] as readonly CurriculumCompletionPair[],
    ),
  );

/**
 * Must a level declaring this pair carry `xpReward === 0`?
 *
 * A package that answers no here ships a level whose completion the engine will
 * refuse for as long as it exists — the learner reaches it, the gate resolves,
 * and `assertReward` rejects the completion because the definition advertises a
 * reward the owner may not pay. There is no owner that can clear that, so it is
 * a permanent lock, which is why the validator refuses it at authoring time.
 */
export function isZeroRewardCompletionPair(
  type: string,
  completionMethod: string,
): boolean {
  return ZERO_REWARD_COMPLETION_PAIRS.has(completionPair(type, completionMethod));
}

/* ------------------------------------------------------------------------ */
/* PHASE-1 ADMIN — administrative forward progression correction             */
/* ------------------------------------------------------------------------ */

/**
 * The owners whose completion asserts a fact about the OUTSIDE WORLD.
 *
 * A checkpoint says a balance authority reported a threshold was reached. A
 * Pocket registration says ATA authenticated a partner event. Neither is a
 * judgement ATA is entitled to make on its own, so no administrative action may
 * ever produce one: an operator who "corrects" a learner past one of these has
 * not corrected a record, they have invented a financial or partner fact.
 *
 * DELIBERATELY NOT DERIVED FROM `ZERO_REWARD_ONLY_PRODUCTION_OWNERS`, even
 * though the two lists hold the same two names today. They answer different
 * questions — "does this owner pay XP?" and "does this owner speak for an
 * external authority?" — and a future owner could easily be one without being
 * the other (a zero-reward internal ceremony, or a paid external certification).
 * Deriving one from the other would silently move this boundary the first time
 * that happened, and this boundary is the whole safety property.
 *
 * PREPROD's existing `staging_attested_*` owners remain the ONLY way these two
 * gates may be satisfied without the real authority, they remain staging-only,
 * and the administrative owner below never calls them.
 */
export const PROTECTED_AUTHORITY_OWNERS = [
  "checkpoint_verification",
  "pocket_registration_postback",
] as const satisfies readonly (keyof typeof PRODUCTION_COMPLETION_PAIRS)[];

/** The pairs an administrative correction may never complete. */
export const PROTECTED_AUTHORITY_COMPLETION_PAIRS: ReadonlySet<CurriculumCompletionPair> =
  new Set(
    PROTECTED_AUTHORITY_OWNERS.flatMap(
      (owner) => PRODUCTION_COMPLETION_PAIRS[owner] as readonly CurriculumCompletionPair[],
    ),
  );

export function isProtectedAuthorityPair(
  type: string,
  completionMethod: string,
): boolean {
  return PROTECTED_AUTHORITY_COMPLETION_PAIRS.has(completionPair(type, completionMethod));
}

/**
 * The pairs `admin_correction` may complete.
 *
 * DERIVED, NEVER LISTED. It is every production pair MINUS the protected ones,
 * computed from `PRODUCTION_COMPLETION_PAIRS` itself. Writing the six pairs out
 * by hand would mean a seventh production pair shipped tomorrow is silently NOT
 * administratively correctable — or, far worse, that a pair moved into
 * `PROTECTED_AUTHORITY_OWNERS` stays correctable because someone updated one
 * list and not the other. There is one list, and subtraction.
 *
 * Today this resolves to exactly:
 *   lesson:lesson · lesson:manual · lesson:assessment_pass ·
 *   final_exam:assessment_pass · report:report_approval · mentor_review:mentor_review
 */
export const ADMIN_CORRECTABLE_COMPLETION_PAIRS: ReadonlySet<CurriculumCompletionPair> =
  new Set(
    (
      Object.keys(PRODUCTION_COMPLETION_PAIRS) as (keyof typeof PRODUCTION_COMPLETION_PAIRS)[]
    )
      .filter(
        (owner) =>
          !(PROTECTED_AUTHORITY_OWNERS as readonly string[]).includes(owner),
      )
      .flatMap((owner) => PRODUCTION_COMPLETION_PAIRS[owner] as readonly CurriculumCompletionPair[]),
  );

export function isAdminCorrectablePair(
  type: string,
  completionMethod: string,
): boolean {
  return ADMIN_CORRECTABLE_COMPLETION_PAIRS.has(completionPair(type, completionMethod));
}
