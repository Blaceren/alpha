import { describe, expect, it } from "vitest";
import { FixedMockClock } from "@/lib/clock";
import { buildDataset } from "./build";
import { REQUIRED_SCENARIOS, validateDataset } from "./validate";

const users = buildDataset(new FixedMockClock());

describe("synthetic dataset", () => {
  it("contains exactly 30 users with stable sequential ids", () => {
    expect(users).toHaveLength(30);
    users.forEach((u, i) => {
      expect(u.identity.userId).toBe(`usr_mock_${String(i + 1).padStart(3, "0")}`);
    });
  });

  it("passes full validation (no issues)", () => {
    const issues = validateDataset(users);
    expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
  });

  it("has unique ids and unique synthetic emails", () => {
    expect(new Set(users.map((u) => u.identity.userId)).size).toBe(30);
    expect(new Set(users.map((u) => u.identity.fullEmail)).size).toBe(30);
  });

  it("uses only synthetic email domains", () => {
    for (const u of users) {
      expect(u.identity.fullEmail).toMatch(/@example\.test$/);
    }
  });

  it("keeps net deposits = FTD + redeposits − successful withdrawals", () => {
    for (const u of users) {
      const ftd = u.financial.ftd?.amountUsd ?? 0;
      const re = u.financial.redeposits.reduce((s, d) => s + d.amountUsd, 0);
      const sw = u.financial.successfulWithdrawals.reduce((s, w) => s + w.amountUsd, 0);
      expect(u.financial.netDepositsUsd).toBe(ftd + re - sw);
    }
  });

  it("covers every required persona scenario", () => {
    const scenarios = new Set(users.map((u) => u.primaryScenario));
    for (const s of REQUIRED_SCENARIOS) expect(scenarios.has(s)).toBe(true);
  });

  it("is deterministic (same clock → identical output)", () => {
    const again = buildDataset(new FixedMockClock());
    expect(JSON.stringify(again)).toBe(JSON.stringify(users));
  });

  it("fails validation when a formula is corrupted", () => {
    const broken = structuredClone(users);
    broken[4]!.financial.netDepositsUsd = 999999;
    expect(validateDataset(broken).length).toBeGreaterThan(0);
  });

  it("has synthetic trader ids only", () => {
    for (const u of users) {
      if (u.financial.traderId) expect(u.financial.traderId).toMatch(/^pp_mock_/);
    }
  });

  it("supports the post-level-100 checkpoint edge case", () => {
    const completed = users.find((u) => u.progression.currentLevel >= 100);
    expect(completed?.progression.checkpointStatus).toBe("future_checkpoint_not_defined");
  });
});
