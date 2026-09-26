/**
 * When the Level 1 Pocket registration action is offered (POCKETCTA-1).
 *
 * Extracted from the level page so the rule is provable on its own rather than
 * only through a rendered server component. Getting it wrong in either direction
 * is a real failure: offered too widely it invites a learner to register against
 * a level that will not credit it, and withheld it turns Level 1 back into the
 * dead end this phase exists to remove.
 *
 * The rule is deliberately a whitelist of the two current-and-incomplete states.
 * An unrecognised state therefore hides the action, which is the safe direction.
 */
import type { AcademyLevelState } from "@/lib/curriculum/progress-state";

export type PocketRegistrationVisibilityInput = {
  /** True only for an `external_event` level — the Pocket-postback kind. */
  readonly isExternal: boolean;
  readonly state: AcademyLevelState;
  /** Why the level's content is unavailable, when it is. */
  readonly contentUnavailableReason: string | null | undefined;
};

export function shouldShowPocketRegistration(
  input: PocketRegistrationVisibilityInput,
): boolean {
  if (!input.isExternal) return false;
  // A learner with no enrolment has nothing to complete against; the Backend
  // reports this rather than the Academy inferring it.
  if (input.contentUnavailableReason === "not_enrolled") return false;
  // `available` and `in_progress` are exactly "current and not finished".
  // `completed`, `pending_review`, `locked` and `checkpoint_unverified` are not.
  return input.state === "available" || input.state === "in_progress";
}

/**
 * XP-L1-FEEDBACK (POCKET-REG-INGRESS-1) — when the learner is TOLD the
 * registration was received.
 *
 * Exactly the complement of the action within the external_event kind: the one
 * Backend state that means "the postback arrived and the level closed" is
 * `completed`, so that is the whole rule. Anything else — including states
 * this module does not recognise — shows nothing, which is the safe direction
 * for a message that asserts an external fact.
 */
export function shouldShowPocketRegistrationConfirmed(input: {
  readonly isExternal: boolean;
  readonly state: AcademyLevelState;
}): boolean {
  return input.isExternal && input.state === "completed";
}
