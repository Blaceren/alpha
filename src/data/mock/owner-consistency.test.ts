/**
 * Effective owner — one resolver, every read (Phase 1B4-C).
 *
 * Owner used to be read straight off the fixture in ten places. Resolving it in each
 * of them separately is how User 360 and Users end up reporting different owners —
 * the drift D-39/D-40 had to undo for financials and the timeline. These tests assert
 * the reads agree, and that the derived cache cannot hide a change from them.
 */
import { describe, expect, it } from "vitest";
import { MockCrmDataProvider } from "./MockCrmDataProvider";
import { MemoryKeyValueStorage } from "./overlay/storage";
import { FixedMockClock, MOCK_NOW } from "@/lib/clock";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";
import { defaultDataset } from "./fixtures/index";

const clock = new FixedMockClock();

/** A user who is in Today's queue, so every surface has a row for them. */
const TARGET = defaultDataset(clock).find(
  (u) => u.operations.primaryOwnerId !== null && u.operations.activeTaskCount > 0,
)!;
const USER_ID = TARGET.identity.userId;
const BASELINE_OWNER = TARGET.operations.primaryOwnerId!;
const NEW_OWNER = BASELINE_OWNER === "emp_ret2" ? "emp_men1" : "emp_ret2";

const ctx: CrmContext = { actorId: "emp_actor_1", role: "crm_admin", now: MOCK_NOW };

function setup() {
  const storage = new MemoryKeyValueStorage();
  return { provider: new MockCrmDataProvider({ clock, storage }), storage };
}

async function assign(provider: MockCrmDataProvider, ownerId: string | null, expected: string | null) {
  const res = await provider.assignPrimaryOwner(ctx, {
    userId: USER_ID,
    ownerId,
    expectedOwnerId: expected,
    idempotencyKey: `k-${ownerId ?? "null"}`,
  });
  expect(res.status).toBe("ok");
  return res;
}

/** Where the user's row sits in Today, whatever section it landed in. */
async function todayRow(provider: MockCrmDataProvider) {
  const ws = await provider.getTodayWorkspace(ctx, {});
  return ws.data!.sections.flatMap((s) => s.items).find((i) => i.userId === USER_ID);
}

describe("effective owner — every read agrees", () => {
  it("getUser360, searchUsers and getUserById report the same new owner", async () => {
    const { provider } = setup();
    await assign(provider, NEW_OWNER, BASELINE_OWNER);

    const view = await provider.getUser360(ctx, { userId: USER_ID });
    const byId = await provider.getUserById(ctx, { userId: USER_ID });
    const search = await provider.searchUsers(ctx, {});
    const row = search.data!.items.find((u) => u.id === USER_ID);

    expect(view.data!.owner.ownerId).toBe(NEW_OWNER);
    expect(byId.data!.ownerId).toBe(NEW_OWNER);
    expect(row!.ownerId).toBe(NEW_OWNER);
  });

  it("Today's row, filters, summary and filter options all move together", async () => {
    const { provider } = setup();

    const before = await provider.getTodayWorkspace(ctx, {});
    const unassignedBefore = before.data!.summary.unassigned;

    await assign(provider, NEW_OWNER, BASELINE_OWNER);

    // The row itself.
    expect((await todayRow(provider))!.ownerId).toBe(NEW_OWNER);

    // The filter finds them under the new owner and not under the old one.
    const underNew = await provider.getTodayWorkspace(ctx, { filters: { ownerId: [NEW_OWNER] } });
    expect(underNew.data!.sections.flatMap((s) => s.items).map((i) => i.userId)).toContain(USER_ID);
    const underOld = await provider.getTodayWorkspace(ctx, { filters: { ownerId: [BASELINE_OWNER] } });
    expect(underOld.data!.sections.flatMap((s) => s.items).map((i) => i.userId)).not.toContain(USER_ID);

    // Options are built from the role's UNFILTERED queue, so the new owner is
    // offerable and the old one is still there for whoever else they own.
    expect(underNew.data!.filterOptions.owners).toContain(NEW_OWNER);

    // Reassigning between two owners changes nobody's assigned-ness. Read from an
    // unfiltered workspace: `summary` counts the items that survived the filter.
    const after = await provider.getTodayWorkspace(ctx, {});
    expect(after.data!.summary.unassigned).toBe(unassignedBefore);
  });

  it("unassigning moves the user into Today's «unassigned» count and filter", async () => {
    const { provider } = setup();
    const before = await provider.getTodayWorkspace(ctx, {});
    const unassignedBefore = before.data!.summary.unassigned;

    await assign(provider, null, BASELINE_OWNER);

    const after = await provider.getTodayWorkspace(ctx, {});
    expect(after.data!.summary.unassigned).toBe(unassignedBefore + 1);

    const filtered = await provider.getTodayWorkspace(ctx, { filters: { ownerId: "unassigned" } });
    expect(filtered.data!.sections.flatMap((s) => s.items).map((i) => i.userId)).toContain(USER_ID);
  });

  it("Users filters and sorts on the new owner", async () => {
    const { provider } = setup();
    await assign(provider, NEW_OWNER, BASELINE_OWNER);

    const underNew = await provider.searchUsers(ctx, { filters: { ownerId: [NEW_OWNER] } });
    expect(underNew.data!.items.map((u) => u.id)).toContain(USER_ID);

    const underOld = await provider.searchUsers(ctx, { filters: { ownerId: [BASELINE_OWNER] } });
    expect(underOld.data!.items.map((u) => u.id)).not.toContain(USER_ID);

    const sorted = await provider.searchUsers(ctx, { sort: { field: "owner", dir: "asc" } });
    const sortedRow = sorted.data!.items.find((u) => u.id === USER_ID);
    expect(sortedRow!.ownerId).toBe(NEW_OWNER);
  });

  it("Users finds an unassigned user under «unassigned»", async () => {
    const { provider } = setup();
    await assign(provider, null, BASELINE_OWNER);

    const res = await provider.searchUsers(ctx, { filters: { ownerId: "unassigned" } });
    expect(res.data!.items.map((u) => u.id)).toContain(USER_ID);
  });

  it("synthetic tasks, cases and queue projections follow the primary owner", async () => {
    const { provider } = setup();
    await assign(provider, NEW_OWNER, BASELINE_OWNER);

    const tasks = await provider.getUserTasks(ctx, { userId: USER_ID });
    for (const t of tasks.data!.items) expect(t.owner).toBe(NEW_OWNER);

    const cases = await provider.getUserCases(ctx, { userId: USER_ID });
    for (const c of cases.data!.items) expect(c.owner).toBe(NEW_OWNER);

    for (const queue of [provider.getMentorQueue, provider.getSupportQueue]) {
      const res = await queue.call(provider, ctx, {});
      const item = res.data!.items.find((i) => i.userId === USER_ID);
      if (item) expect(item.owner).toBe(NEW_OWNER);
    }
  });

  it("owner changes nothing else about the user — not priority, not signals", async () => {
    const { provider } = setup();
    const before = await provider.getUser360(ctx, { userId: USER_ID });
    await assign(provider, NEW_OWNER, BASELINE_OWNER);
    const after = await provider.getUser360(ctx, { userId: USER_ID });

    expect(after.data!.attention).toEqual(before.data!.attention);
    expect(after.data!.signals).toEqual(before.data!.signals);
    expect(after.data!.states).toEqual(before.data!.states);
    expect(after.data!.financial).toEqual(before.data!.financial);
    // …and the one thing that did change.
    expect(before.data!.owner.ownerId).toBe(BASELINE_OWNER);
    expect(after.data!.owner.ownerId).toBe(NEW_OWNER);
  });
});

describe("effective owner — the derived cache cannot hide a change", () => {
  it("a warm cache still yields the new owner", async () => {
    const { provider } = setup();
    // Warm every cache path first.
    await provider.searchUsers(ctx, {});
    await provider.getUser360(ctx, { userId: USER_ID });
    await provider.getTodayWorkspace(ctx, {});

    await assign(provider, NEW_OWNER, BASELINE_OWNER);

    expect((await provider.getUser360(ctx, { userId: USER_ID })).data!.owner.ownerId).toBe(NEW_OWNER);
    const search = await provider.searchUsers(ctx, {});
    expect(search.data!.items.find((u) => u.id === USER_ID)!.ownerId).toBe(NEW_OWNER);
    expect((await todayRow(provider))!.ownerId).toBe(NEW_OWNER);
  });

  /**
   * The cross-instance case the cache guard exists for: provider B never saw the
   * command, so nothing told it to invalidate. It reads the overlay from storage on
   * every call, and its cache entry has to notice the owner it holds is not the one
   * being asked about.
   */
  it("a change written through another provider is not masked by a warm cache", async () => {
    const storage = new MemoryKeyValueStorage();
    const a = new MockCrmDataProvider({ clock, storage });
    const b = new MockCrmDataProvider({ clock, storage });

    // Warm B's cache on the old value.
    expect((await b.getUser360(ctx, { userId: USER_ID })).data!.owner.ownerId).toBe(BASELINE_OWNER);
    await b.searchUsers(ctx, {});

    // A writes.
    await assign(a, NEW_OWNER, BASELINE_OWNER);

    // B must see it.
    expect((await b.getUser360(ctx, { userId: USER_ID })).data!.owner.ownerId).toBe(NEW_OWNER);
    const search = await b.searchUsers(ctx, {});
    expect(search.data!.items.find((u) => u.id === USER_ID)!.ownerId).toBe(NEW_OWNER);
  });

  it("a warm cache survives a change to a different user untouched", async () => {
    const { provider } = setup();
    const other = defaultDataset(clock).find((u) => u.identity.userId !== USER_ID)!;

    const before = await provider.getUser360(ctx, { userId: other.identity.userId });
    await assign(provider, NEW_OWNER, BASELINE_OWNER);
    const after = await provider.getUser360(ctx, { userId: other.identity.userId });

    expect(after.data).toEqual(before.data);
  });
});

describe("fixture note author is frozen (Phase 1B4-C)", () => {
  /**
   * The seeded note is authored by the user's owner. Reading that off the effective
   * user would rewrite who wrote a two-day-old note every time someone reassigned —
   * authorship is a historical fact, not a live pointer.
   */
  it("the author does not follow a reassignment", async () => {
    const { provider } = setup();

    const before = await provider.getUserNotes(ctx, { userId: USER_ID });
    const authorBefore = before.data!.items[0]!.authorEmployeeId;
    expect(authorBefore).toBe(BASELINE_OWNER);

    await assign(provider, NEW_OWNER, BASELINE_OWNER);

    const after = await provider.getUserNotes(ctx, { userId: USER_ID });
    expect(after.data!.items[0]!.authorEmployeeId).toBe(authorBefore);
    expect(after.data!.items[0]!.authorEmployeeId).not.toBe(NEW_OWNER);
  });

  it("the author does not become the demo actor after an unassign", async () => {
    const { provider } = setup();
    await assign(provider, null, BASELINE_OWNER);

    const after = await provider.getUserNotes(ctx, { userId: USER_ID });
    expect(after.data!.items[0]!.authorEmployeeId).toBe(BASELINE_OWNER);
  });

  it("the note itself is otherwise unchanged", async () => {
    const { provider } = setup();
    const before = await provider.getUserNotes(ctx, { userId: USER_ID });
    await assign(provider, NEW_OWNER, BASELINE_OWNER);
    const after = await provider.getUserNotes(ctx, { userId: USER_ID });

    expect(after.data!.items).toEqual(before.data!.items);
  });
});
