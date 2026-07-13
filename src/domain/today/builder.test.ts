import { describe, expect, it } from "vitest";
import { FixedMockClock } from "@/lib/clock";
import { buildDataset } from "@/data/mock/fixtures/build";
import { buildTodayWorkspace } from "./builder";

const clock = new FixedMockClock();
const users = buildDataset(clock);

describe("Today workspace builder", () => {
  const ws = buildTodayWorkspace(users, clock, "crm_admin");

  it("produces all thirteen queues with canonical codes (no bare `critical`)", () => {
    expect(ws.queues).toHaveLength(13);
    const codes = ws.queues.map((q) => q.code);
    expect(codes).toContain("critical_attention");
    expect(codes).toContain("onboarding_attention");
    expect(codes).toContain("data_quality_issues");
    expect(codes).not.toContain("critical");
  });

  it("places onboarding users 001/002/003 into onboarding_attention", () => {
    const onboarding = ws.queues.find((q) => q.code === "onboarding_attention")!;
    const ids = onboarding.items.map((i) => i.userId);
    expect(ids).toContain("usr_mock_001");
    expect(ids).toContain("usr_mock_002");
    expect(ids).toContain("usr_mock_003");
    // Financial values are not shown for onboarding items.
    expect(onboarding.items.every((i) => i.financial.mode === "hidden")).toBe(true);
    // Each item carries a reason and an identity projection.
    expect(onboarding.items.every((i) => i.reason.length > 0 && i.identity.mode)).toBe(true);
  });

  it("keeps global higher priority even when a user is also in onboarding", () => {
    // usr_mock_003 (email_not_confirmed) is normal priority in onboarding.
    const item = ws.queues
      .find((q) => q.code === "onboarding_attention")!
      .items.find((i) => i.userId === "usr_mock_003")!;
    expect(item.priority).toBe("normal");
  });

  it("places support-blocked user in critical + support queues", () => {
    const critical = ws.queues.find((q) => q.code === "critical_attention")!;
    const support = ws.queues.find((q) => q.code === "support_blockers")!;
    expect(critical.items.some((i) => i.userId === "usr_mock_026")).toBe(true);
    expect(support.items.some((i) => i.userId === "usr_mock_026")).toBe(true);
  });

  it("deduplicates users across queues in the summary count", () => {
    const totalItems = ws.queues.reduce((s, q) => s + q.items.length, 0);
    // A user appears in several queues, so distinct < total placements.
    expect(ws.distinctUserCount).toBeLessThan(totalItems);
    expect(ws.distinctUserCount).toBeGreaterThan(0);
  });

  it("orders queue items by priority deterministically", () => {
    const rank = { critical: 0, high: 1, normal: 2, low: 3 } as const;
    for (const q of ws.queues) {
      const ranks = q.items.map((i) => rank[i.priority]);
      expect([...ranks]).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it("projects financials per role (mentor gets buckets, retention gets exact)", () => {
    const asMentor = buildTodayWorkspace(users, clock, "mentor");
    const asRetention = buildTodayWorkspace(users, clock, "retention_manager");
    const mItem = asMentor.queues.flatMap((q) => q.items).find((i) => i.financial.mode !== "hidden");
    const rItem = asRetention.queues.flatMap((q) => q.items).find((i) => i.financial.mode !== "hidden");
    if (mItem) expect(["bucket", "aggregated"]).toContain(mItem.financial.mode);
    if (rItem) expect(rItem.financial.mode).toBe("exact");
  });

  it("is deterministic", () => {
    const again = buildTodayWorkspace(users, clock, "crm_admin");
    expect(again.distinctUserCount).toBe(ws.distinctUserCount);
    expect(again.queues.map((q) => q.items.length)).toEqual(ws.queues.map((q) => q.items.length));
  });
});
