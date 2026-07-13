import { describe, expect, it } from "vitest";
import { FixedMockClock } from "@/lib/clock";
import { buildDataset } from "@/data/mock/fixtures/build";
import { computeSignals } from "@/domain/signals/engine";
import { comparePriority, computePriority } from "./priority";

const clock = new FixedMockClock();
const users = buildDataset(clock);
const byId = (id: string) => users.find((u) => u.identity.userId === id)!;
const prio = (id: string) => {
  const u = byId(id);
  return computePriority(u, computeSignals(u, clock), clock);
};

describe("priority rules", () => {
  it("critical support issue → critical", () => {
    expect(prio("usr_mock_026").level).toBe("critical");
    expect(prio("usr_mock_026").reasonCode).toBe("critical_support_issue");
  });

  it("financial access suspended → critical", () => {
    expect(prio("usr_mock_014").level).toBe("critical");
  });

  it("financial data conflict → high", () => {
    const p = prio("usr_mock_029");
    expect(p.level).toBe("high");
    expect(p.reasonCode).toBe("financial_data_conflict");
  });

  it("mentor SLA breach → high", () => {
    const p = prio("usr_mock_011");
    expect(p.level).toBe("high");
  });

  it("every priority result carries a reasonCode and evidence array", () => {
    for (const u of users) {
      const p = computePriority(u, computeSignals(u, clock), clock);
      expect(p.reasonCode.length).toBeGreaterThan(0);
      expect(Array.isArray(p.evidence)).toBe(true);
    }
  });

  it("comparePriority is deterministic and total (stable sort by id on ties)", () => {
    const derived = users.map((u) => {
      const signals = computeSignals(u, clock);
      return { user: u, signals, priority: computePriority(u, signals, clock) };
    });
    const a = [...derived].sort((x, y) => comparePriority(x, y, clock)).map((d) => d.user.identity.userId);
    const b = [...derived].reverse().sort((x, y) => comparePriority(x, y, clock)).map((d) => d.user.identity.userId);
    expect(a).toEqual(b);
    // Critical users sort ahead of low-priority ones.
    expect(a.indexOf("usr_mock_026")).toBeLessThan(a.indexOf("usr_mock_005"));
  });
});
