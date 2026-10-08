/**
 * A LEARNER NEVER READS THE BROKER'S OWN EVENTS.
 *
 * The failure this stops (PREPROD, 2026-10-04): the register, the bell and
 * Home's «Что нового» showed «Получено событие биржи / Получен exchange
 * postback: first_deposit.» — a deposit, in the postback's raw words, inside a
 * product whose first rule is that it never shows a learner's money.
 */
import { describe, it, expect } from "vitest";
import { isLearnerFacingNotificationType } from "@/lib/notifications/learner-facing";
import { isVisibleNotificationType } from "@/config/feature-visibility";

describe("learner-facing notification types", () => {
  it("never shows a broker event", () => {
    for (const type of ["postback_received", "exchange_connected", "exchange_rejected", "exchange_blocked"]) {
      expect(isLearnerFacingNotificationType(type)).toBe(false);
    }
  });

  it("still withholds what the visibility config withholds", () => {
    expect(isVisibleNotificationType("community_reply")).toBe(false);
    expect(isLearnerFacingNotificationType("community_reply")).toBe(false);
  });

  it("keeps every learning event the register shows", () => {
    for (const type of ["level_up", "rank_up", "xp_awarded", "mentor_reply", "support_reply", "system"]) {
      expect(isLearnerFacingNotificationType(type)).toBe(isVisibleNotificationType(type));
    }
    expect(isLearnerFacingNotificationType("support_reply")).toBe(true);
  });

  it("treats a missing type the way the register always has", () => {
    expect(isLearnerFacingNotificationType(undefined)).toBe(isVisibleNotificationType(""));
    expect(isLearnerFacingNotificationType(null)).toBe(isVisibleNotificationType(""));
  });
});
