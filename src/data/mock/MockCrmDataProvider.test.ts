import { describe, expect, it } from "vitest";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "./MockCrmDataProvider";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";

const clock = new FixedMockClock();
const ctx = (role: CrmContext["role"]): CrmContext => ({ actorId: "emp_mock_admin", role, now: clock.nowIso() });
const admin = ctx("crm_admin");

function provider(opts = {}) {
  return new MockCrmDataProvider({ clock, ...opts });
}

describe("MockCrmDataProvider — core modes", () => {
  it("returns all 30 users on the happy path", async () => {
    const res = await provider().searchUsers(admin, { page: { pageSize: 100 } });
    expect(res.status).toBe("ok");
    expect(res.data?.items.length).toBe(30);
  });

  it("paginates with a cursor", async () => {
    const p = provider();
    const first = await p.searchUsers(admin, { page: { pageSize: 10 } });
    expect(first.data?.items.length).toBe(10);
    expect(first.data?.page.nextCursor).toBe("10");
    const second = await p.searchUsers(admin, { page: { cursor: "10", pageSize: 10 } });
    expect(second.data?.items[0]?.id).not.toBe(first.data?.items[0]?.id);
  });

  it("supports error and empty modes", async () => {
    expect((await provider({ errorMode: true }).searchUsers(admin, {})).status).toBe("error");
    expect((await provider({ emptyMode: true }).searchUsers(admin, {})).status).toBe("empty");
  });

  it("marks stale users on getUserById", async () => {
    const res = await provider().getUserById(admin, { userId: "usr_mock_024" }); // no balance timestamp
    expect(["stale", "ok"]).toContain(res.status);
    expect(res.data?.id).toBe("usr_mock_024");
  });

  it("returns not_found for unknown users", async () => {
    const res = await provider().getUserById(admin, { userId: "nope" });
    expect(res.error?.code).toBe("not_found");
  });
});

describe("MockCrmDataProvider — filters & sort", () => {
  it("filters across the five state dimensions", async () => {
    const p = provider();
    const byLifecycle = await p.searchUsers(admin, { filters: { lifecycleStage: ["dormant"] } });
    expect(byLifecycle.data?.items.every((u) => u.lifecycleStage === "dormant")).toBe(true);

    const byFunding = await p.searchUsers(admin, { filters: { fundingStatus: ["checkpoint_grace"] } });
    expect(byFunding.data?.items.length).toBeGreaterThan(0);

    const byBlocker = await p.searchUsers(admin, { filters: { blocker: ["support_blocked"] } });
    expect(byBlocker.data?.items.length).toBeGreaterThan(0);

    const bySignal = await p.searchUsers(admin, { filters: { signals: ["rapid_balance_decline"] } });
    expect(bySignal.data?.items.length).toBeGreaterThan(0);
  });

  it("filters by renamed Pocket-registration semantics", async () => {
    const p = provider();
    const stage = await p.searchUsers(admin, { filters: { lifecycleStage: ["pocket_registered"] } });
    expect(stage.data?.items.every((u) => u.lifecycleStage === "pocket_registered")).toBe(true);

    const funding = await p.searchUsers(admin, { filters: { fundingStatus: ["not_available"] } });
    expect(funding.data?.items.length).toBeGreaterThan(0);
    expect(funding.data?.items.every((u) => u.fundingStatus === "not_available")).toBe(true);

    const blocker = await p.searchUsers(admin, { filters: { blocker: ["pocket_registration_incomplete"] } });
    expect(blocker.data?.items.length).toBeGreaterThan(0);
    expect(blocker.data?.items.every((u) => u.blockers?.includes("pocket_registration_incomplete"))).toBe(true);
  });

  it("applies compound filters (AND semantics)", async () => {
    const res = await provider().searchUsers(admin, {
      filters: { fundingStatus: ["funded"], engagementStatus: ["active"], currentLevelMin: 10 },
    });
    expect(res.data?.items.every((u) => u.currentLevel >= 10)).toBe(true);
  });

  it("free-text search matches name / id", async () => {
    const res = await provider().searchUsers(admin, { query: "Nadia" });
    expect(res.data?.items.some((u) => u.displayName.includes("Nadia"))).toBe(true);
  });

  it("supports unassigned owner filter", async () => {
    const res = await provider().searchUsers(admin, { filters: { ownerId: "unassigned" } });
    expect(res.data?.items.every((u) => u.ownerId === null)).toBe(true);
    expect(res.data!.items.length).toBeGreaterThan(0);
  });

  it("sorts by level ascending", async () => {
    const res = await provider().searchUsers(admin, { sort: { field: "currentLevel", dir: "asc" }, page: { pageSize: 100 } });
    const levels = res.data!.items.map((u) => u.currentLevel);
    expect([...levels]).toEqual([...levels].sort((a, b) => a - b));
  });
});

describe("MockCrmDataProvider — permission projections", () => {
  it("shows exact balance to retention, bucket to mentor, and rejects unprivileged financial sort", async () => {
    const p = provider();
    const asRetention = await p.getUserById(ctx("retention_manager"), { userId: "usr_mock_017" });
    expect(asRetention.data?.balance?.mode).toBe("exact");

    const asMentor = await p.getUserById(ctx("mentor"), { userId: "usr_mock_017" });
    expect(asMentor.data?.balance?.mode).toBe("bucket");
    expect(asMentor.data?.balance?.amountUsd).toBeNull();

    const asAnalyst = await p.getUserById(ctx("analyst"), { userId: "usr_mock_017" });
    expect(asAnalyst.data?.balance?.mode).toBe("aggregated");

    const sortLeak = await p.searchUsers(ctx("mentor"), { sort: { field: "balance", dir: "desc" } });
    expect(sortLeak.error?.code).toBe("invalid_input");
  });
});

describe("MockCrmDataProvider — other read ops", () => {
  it("computes segments with counts", async () => {
    const res = await provider().getSegments(admin, {});
    expect(res.data?.length).toBeGreaterThanOrEqual(12);
    expect(res.data?.every((s) => (s.count ?? 0) >= 0)).toBe(true);
  });

  it("returns signals and recommendations for a user", async () => {
    const sig = await provider().getUserSignals(admin, { userId: "usr_mock_001" });
    expect(sig.data?.some((s) => s.code === "registration_no_start")).toBe(true);
    const rec = await provider().getRecommendedActions(admin, { userId: "usr_mock_026" });
    expect(rec.data?.some((r) => r.title.length > 0)).toBe(true);
  });

  it("builds mentor and support queues", async () => {
    expect((await provider().getMentorQueue(admin, {})).data?.items.length).toBeGreaterThan(0);
    expect((await provider().getSupportQueue(admin, {})).data?.items.length).toBeGreaterThan(0);
  });

  it("returns a financial operations summary", async () => {
    const res = await provider().getFinancialOperationsSummary(admin, {});
    expect(res.data?.checkpointGrace).toBeGreaterThan(0);
    expect(res.data?.dataConflicts).toBeGreaterThan(0);
  });
});
