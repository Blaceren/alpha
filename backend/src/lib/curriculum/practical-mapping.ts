/**
 * A2 / product decision R1 — how a canonical PRACTICAL level becomes a package
 * level.
 *
 * THE DECISION THIS ENCODES
 * The canonical curriculum has 20 practical levels. They do NOT get a new
 * completion owner, and they are NOT all routed through report approval:
 *
 *   * the 7 with `mentorReview = true` are `mentor_review:mentor_review`;
 *   * the remaining 13 are `lesson:manual`.
 *
 * `lesson:manual` means exactly this: real practical instructional content
 * exists, the learner performs the exercise, an explicit completion action
 * records it, the action is idempotent, and XP/unlock go through the one
 * canonical completion engine. It does NOT mean "a lesson the learner reads".
 * The learner-facing presentation is free to keep calling these levels
 * «Практика» — presentation and completion ownership are different questions.
 *
 * WHY NOT A NEW OWNER
 * `practice:self_complete` (or any sibling) would be a second progression
 * vocabulary with its own authorization story, its own idempotency story and
 * its own audit story, for a completion that is behaviourally identical to
 * `lesson:manual` — which `completion.ts` already owns, has always owned, and
 * has regression coverage for. Adding an owner buys a label and costs a
 * security surface.
 *
 * WHAT THIS MODULE IS AND IS NOT
 * It is the mapping and its validator: the primitives Phase C needs when it
 * converts the editorial canonical source into a package. It is NOT the
 * converter, and it does NOT rewrite the 100-level package — that is Phase C.
 *
 * An individual practical level may later be upgraded to the report workflow.
 * That is content configuration (a different pair in the package), not a new
 * domain type, and nothing here has to change for it.
 */
import { isOwnedCompletionPair } from "./completion-pairs";

/** The editorial fact that decides the mapping. Nothing else does. */
export type PracticalLevelSource = {
  /** True for the 7 practical levels that are reviewed by a mentor. */
  readonly mentorReview: boolean;
};

export type PracticalLevelContract = {
  readonly type: "mentor_review" | "lesson";
  readonly completionMethod: "mentor_review" | "manual";
};

/** The 7 mentor-reviewed practical levels. */
export const PRACTICAL_MENTOR_REVIEW_CONTRACT: PracticalLevelContract = {
  type: "mentor_review",
  completionMethod: "mentor_review",
};

/** The remaining 13 practical levels. */
export const PRACTICAL_MANUAL_CONTRACT: PracticalLevelContract = {
  type: "lesson",
  completionMethod: "manual",
};

export const PRACTICAL_LEVEL_CONTRACTS: readonly PracticalLevelContract[] = [
  PRACTICAL_MENTOR_REVIEW_CONTRACT,
  PRACTICAL_MANUAL_CONTRACT,
];

/**
 * The mapping. Total over its input: there is no third answer and no fallback,
 * so a practical level cannot end up with a pair nobody owns.
 */
export function resolvePracticalLevelContract(
  source: PracticalLevelSource,
): PracticalLevelContract {
  return source.mentorReview
    ? PRACTICAL_MENTOR_REVIEW_CONTRACT
    : PRACTICAL_MANUAL_CONTRACT;
}

/** Is this pair one of the two canonical practical contracts? */
export function isPracticalLevelContract(
  type: string,
  completionMethod: string,
): boolean {
  return PRACTICAL_LEVEL_CONTRACTS.some(
    (contract) =>
      contract.type === type && contract.completionMethod === completionMethod,
  );
}

export type PracticalMappingIssueCode =
  /** The candidate pair is not what the editorial source maps to. */
  | "PRACTICAL_MAPPING_MISMATCH"
  /**
   * The mapping itself produced a pair no production owner can complete. Only
   * reachable if `completion.ts` and this module ever disagree, which is exactly
   * the drift worth failing on rather than shipping.
   */
  | "PRACTICAL_CONTRACT_UNOWNED";

export type PracticalMappingIssue = {
  readonly code: PracticalMappingIssueCode;
  readonly expected: PracticalLevelContract;
  readonly message: string;
};

/**
 * Check a candidate package pair against what the editorial source requires.
 *
 * Returns `null` when the candidate is exactly the mapped contract. Phase C's
 * converter is expected to call `resolvePracticalLevelContract` and then this,
 * so a hand-edited package cannot quietly move a practical level onto a
 * different owner.
 */
export function validatePracticalLevelMapping(
  source: PracticalLevelSource,
  candidate: { type: string; completionMethod: string },
): PracticalMappingIssue | null {
  const expected = resolvePracticalLevelContract(source);

  if (!isOwnedCompletionPair(expected.type, expected.completionMethod)) {
    return {
      code: "PRACTICAL_CONTRACT_UNOWNED",
      expected,
      message: `practical contract ${expected.type}:${expected.completionMethod} has no completion owner`,
    };
  }
  if (
    candidate.type !== expected.type ||
    candidate.completionMethod !== expected.completionMethod
  ) {
    return {
      code: "PRACTICAL_MAPPING_MISMATCH",
      expected,
      message: `practical level must be ${expected.type}:${expected.completionMethod}`,
    };
  }
  return null;
}
