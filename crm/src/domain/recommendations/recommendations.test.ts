import { describe, expect, it } from "vitest";
import { FixedMockClock } from "@/lib/clock";
import { buildDataset } from "@/data/mock/fixtures/build";
import { computeSignals } from "@/domain/signals/engine";
import { deriveRecommendations } from "./derive";
import { PROHIBITED_ACTION_CODES, RECOMMENDATION_CATALOG, SIGNAL_TO_ACTIONS } from "./catalog";

const clock = new FixedMockClock();
const users = buildDataset(clock);
const byId = (id: string) => users.find((u) => u.identity.userId === id)!;
const recFor = (id: string) => {
  const u = byId(id);
  return deriveRecommendations(u, computeSignals(u, clock));
};

describe("recommendation catalog safety", () => {
  it("contains no prohibited financial-pressure actions", () => {
    const codes = Object.keys(RECOMMENDATION_CATALOG);
    for (const banned of PROHIBITED_ACTION_CODES) {
      expect(codes).not.toContain(banned);
    }
  });

  it("every recommendation has allowed roles and a reason", () => {
    for (const def of Object.values(RECOMMENDATION_CATALOG)) {
      expect(def.allowedRoles.length).toBeGreaterThan(0);
      expect(def.reason.length).toBeGreaterThan(0);
      expect(typeof def.cooldownHours).toBe("number");
    }
  });

  it("maps every signal code to at least one action", () => {
    for (const codes of Object.values(SIGNAL_TO_ACTIONS)) {
      expect(codes.length).toBeGreaterThan(0);
    }
  });
});

describe("recommendation derivation", () => {
  it("derives support follow-up for a support-blocked user", () => {
    const codes = recFor("usr_mock_026").map((r) => r.code);
    expect(codes).toContain("support_follow_up");
  });

  it("only educational/support responses after balance decline (usr_mock_029)", () => {
    const codes = recFor("usr_mock_029").map((r) => r.code);
    expect(codes).toContain("review_risk_material");
    for (const banned of PROHIBITED_ACTION_CODES) expect(codes).not.toContain(banned);
  });

  it("suppresses outbound nudges under communication fatigue (usr_mock_027)", () => {
    const recs = recFor("usr_mock_027");
    const codes = recs.map((r) => r.code);
    expect(codes).toContain("reduce_communication_frequency");
    // No in_app/email outbound nudge should survive fatigue.
    expect(codes).not.toContain("continue_current_lesson");
    expect(codes).not.toContain("offer_learning_recap");
  });

  it("falls back to no_action_required when there are no signals", () => {
    const u = byId("usr_mock_005");
    const recs = deriveRecommendations(u, []);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.code).toBe("no_action_required");
  });
});
