import { describe, expect, it } from "vitest";
import { FixedMockClock } from "@/lib/clock";
import { buildDataset } from "@/data/mock/fixtures/build";
import { computeSignals } from "./engine";
import type { MockUser } from "@/domain/users/mock-user";

const clock = new FixedMockClock();
const users = buildDataset(clock);
const byId = (id: string) => users.find((u) => u.identity.userId === id) as MockUser;
const codes = (u: MockUser) => computeSignals(u, clock).map((s) => s.code);

describe("signal engine (deterministic, FixedMockClock)", () => {
  it("new registration → registration_no_start + pocket_registration_incomplete", () => {
    const c = codes(byId("usr_mock_001"));
    expect(c).toContain("registration_no_start");
    expect(c).toContain("pocket_registration_incomplete");
  });

  it("pocket_registration_incomplete: threshold + confirmed-registration behaviour", () => {
    const base = byId("usr_mock_002");
    // Below 24h since registration → no signal.
    const fresh: MockUser = { ...base, identity: { ...base.identity, registeredAt: new Date(clock.nowMs() - 20 * 3600_000).toISOString() } };
    expect(computeSignals(fresh, clock).map((s) => s.code)).not.toContain("pocket_registration_incomplete");
    // At/after 24h → signal present, mapped to the registration recommendation.
    const sig = computeSignals(byId("usr_mock_002"), clock).find((s) => s.code === "pocket_registration_incomplete");
    expect(sig).toBeTruthy();
    expect(sig!.recommendedActionCodes).toContain("help_complete_pocket_registration");
    // Backend-confirmed Pocket registration (registered) → signal gone.
    const registered: MockUser = { ...base, financial: { ...base.financial, registrationStatus: "registered" } };
    expect(computeSignals(registered, clock).map((s) => s.code)).not.toContain("pocket_registration_incomplete");
  });

  it("computes email / test / report signals", () => {
    expect(codes(byId("usr_mock_003"))).toContain("email_not_confirmed");
    expect(codes(byId("usr_mock_007"))).toContain("repeated_test_failure");
    expect(codes(byId("usr_mock_008"))).toContain("report_pending");
    expect(codes(byId("usr_mock_009"))).toContain("report_rejected_no_return");
  });

  it("flags mentor SLA breach for usr_mock_011", () => {
    const sig = computeSignals(byId("usr_mock_011"), clock).find((s) => s.code === "mentor_sla_risk");
    expect(sig).toBeTruthy();
    expect(sig!.evidence.some((e) => e.code === "sla_breached" && e.value === true)).toBe(true);
  });

  it("marks financial_access_suspended as critical", () => {
    const sig = computeSignals(byId("usr_mock_014"), clock).find((s) => s.code === "financial_access_suspended");
    expect(sig?.severity).toBe("critical");
    expect(sig?.suppression.suppressesOutbound).toBe(true);
  });

  it("detects checkpoint grace, conflict and rapid decline together (usr_mock_029)", () => {
    const c = codes(byId("usr_mock_029"));
    expect(c).toContain("checkpoint_grace_active");
    expect(c).toContain("pocket_data_conflict");
    expect(c).toContain("rapid_balance_decline");
  });

  it("boundary: usr_mock_021 has inactive_3_days but not inactive_7_days", () => {
    const c = codes(byId("usr_mock_021"));
    expect(c).toContain("inactive_3_days");
    expect(c).not.toContain("inactive_7_days");
  });

  it("suppresses shallower inactivity signals when dormant (usr_mock_023 = 15d)", () => {
    const c = codes(byId("usr_mock_023"));
    expect(c).toContain("dormant_14_days");
    expect(c).not.toContain("inactive_3_days");
    expect(c).not.toContain("inactive_7_days");
  });

  it("treats missing balance timestamp as stale (usr_mock_024)", () => {
    expect(codes(byId("usr_mock_024"))).toContain("balance_data_stale");
  });

  it("communication_fatigue suppresses outbound (usr_mock_027)", () => {
    const sig = computeSignals(byId("usr_mock_027"), clock).find((s) => s.code === "communication_fatigue");
    expect(sig?.suppression.suppressesOutbound).toBe(true);
  });

  it("frequent_redeposit_pattern for 6 redeposits (usr_mock_018)", () => {
    expect(codes(byId("usr_mock_018"))).toContain("frequent_redeposit_pattern");
  });

  it("every signal carries evidence, calculatedAt and recommended actions", () => {
    for (const u of users) {
      for (const s of computeSignals(u, clock)) {
        expect(s.calculatedAt).toBeTruthy();
        expect(Array.isArray(s.evidence)).toBe(true);
        expect(Array.isArray(s.recommendedActionCodes)).toBe(true);
        expect(s.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it("boundary flips exactly at the inactivity threshold", () => {
    const base = byId("usr_mock_021");
    // 71h < 72h threshold → no inactive_3_days
    const before: MockUser = { ...base, progression: { ...base.progression, lastMeaningfulActionAt: new Date(clock.nowMs() - 71 * 3600_000).toISOString() } };
    const after: MockUser = { ...base, progression: { ...base.progression, lastMeaningfulActionAt: new Date(clock.nowMs() - 73 * 3600_000).toISOString() } };
    expect(computeSignals(before, clock).map((s) => s.code)).not.toContain("inactive_3_days");
    expect(computeSignals(after, clock).map((s) => s.code)).toContain("inactive_3_days");
  });
});
