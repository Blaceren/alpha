/**
 * POCKETCTA-1 — when the Level 1 Pocket action is offered.
 *
 * Both directions matter. Offered on a completed level it invites a learner to
 * register again for nothing; withheld on the current level it restores the dead
 * end. An unrecognised state must hide it — failing closed is the safe way to be
 * wrong about progression.
 */
import { describe, it, expect } from "vitest";
import { shouldShowPocketRegistration } from "@/features/pocket-registration/model/pocket-registration-visibility";
import type { AcademyLevelState } from "@/lib/curriculum/progress-state";

const enrolledExternal = (state: AcademyLevelState) => ({
  isExternal: true,
  state,
  contentUnavailableReason: null,
});

describe("shouldShowPocketRegistration", () => {
  it("is shown on the current, incomplete registration level", () => {
    expect(shouldShowPocketRegistration(enrolledExternal("available"))).toBe(true);
    expect(shouldShowPocketRegistration(enrolledExternal("in_progress"))).toBe(true);
  });

  it("is hidden once the level is completed", () => {
    // The postback completed it; there is nothing left to ask for.
    expect(shouldShowPocketRegistration(enrolledExternal("completed"))).toBe(false);
  });

  it("is hidden on every state that is not current-and-incomplete", () => {
    for (const state of ["locked", "pending_review", "checkpoint_unverified"] as AcademyLevelState[]) {
      expect(shouldShowPocketRegistration(enrolledExternal(state)), state).toBe(false);
    }
  });

  it("is hidden when the learner is not enrolled", () => {
    expect(
      shouldShowPocketRegistration({
        isExternal: true,
        state: "available",
        contentUnavailableReason: "not_enrolled",
      }),
    ).toBe(false);
  });

  it("is hidden on every level that is not the external-event kind", () => {
    // A lesson, a report and a financial checkpoint each have their own owner.
    for (const state of ["available", "in_progress"] as AcademyLevelState[]) {
      expect(
        shouldShowPocketRegistration({ isExternal: false, state, contentUnavailableReason: null }),
        state,
      ).toBe(false);
    }
  });

  it("fails closed on an unrecognised state", () => {
    expect(
      shouldShowPocketRegistration({
        isExternal: true,
        state: "something_new" as AcademyLevelState,
        contentUnavailableReason: null,
      }),
    ).toBe(false);
  });

  it("tolerates an absent unavailability reason", () => {
    expect(
      shouldShowPocketRegistration({ isExternal: true, state: "available", contentUnavailableReason: undefined }),
    ).toBe(true);
  });
});

/**
 * XP-L1-FEEDBACK (POCKET-REG-INGRESS-1) — when the learner is TOLD the
 * registration was received. The confirmed message asserts an external fact,
 * so it may appear only in the one state the Backend uses to mean it.
 */
import { shouldShowPocketRegistrationConfirmed } from "@/features/pocket-registration/model/pocket-registration-visibility";

describe("shouldShowPocketRegistrationConfirmed", () => {
  it("is shown exactly when the external-event level is completed", () => {
    expect(
      shouldShowPocketRegistrationConfirmed({ isExternal: true, state: "completed" }),
    ).toBe(true);
  });

  it("is hidden in every not-completed state, the action's states included", () => {
    for (const state of [
      "available",
      "in_progress",
      "pending_review",
      "checkpoint_unverified",
      "locked",
    ] as AcademyLevelState[]) {
      expect(
        shouldShowPocketRegistrationConfirmed({ isExternal: true, state }),
        state,
      ).toBe(false);
    }
  });

  it("is hidden on every level that is not the external-event kind", () => {
    expect(
      shouldShowPocketRegistrationConfirmed({ isExternal: false, state: "completed" }),
    ).toBe(false);
  });

  it("fails closed on an unrecognised state", () => {
    expect(
      shouldShowPocketRegistrationConfirmed({
        isExternal: true,
        state: "something_new" as AcademyLevelState,
      }),
    ).toBe(false);
  });

  it("the action and the confirmation are never shown together", () => {
    for (const state of [
      "completed",
      "available",
      "in_progress",
      "pending_review",
      "locked",
    ] as AcademyLevelState[]) {
      const action = shouldShowPocketRegistration({
        isExternal: true,
        state,
        contentUnavailableReason: null,
      });
      const confirmed = shouldShowPocketRegistrationConfirmed({ isExternal: true, state });
      expect(action && confirmed, state).toBe(false);
    }
  });
});
