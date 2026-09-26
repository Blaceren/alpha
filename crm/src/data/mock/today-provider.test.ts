/**
 * `getTodayWorkspace` at the provider boundary (Phase 1B3). The builder is
 * tested directly elsewhere; this pins the CONTRACT the UI depends on —
 * result envelope, error/empty/stale modes, and that `ctx.role` is honoured.
 */
import { describe, expect, it } from "vitest";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "./MockCrmDataProvider";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";
import { CRM_ROLES, type CrmRole } from "@/domain/identity/roles";
import { TODAY_SECTION_ORDER } from "@/config/queues";

const clock = new FixedMockClock();
const ctx = (role: CrmRole): CrmContext => ({ actorId: "emp_test", role, now: clock.nowIso() });
const provider = new MockCrmDataProvider({ clock, delayMs: 0 });

describe("getTodayWorkspace — result envelope", () => {
  it("returns an ok result with freshness", async () => {
    const res = await provider.getTodayWorkspace(ctx("crm_admin"), {});
    expect(res.status).toBe("ok");
    expect(res.error).toBeNull();
    expect(res.freshness).not.toBeNull();
    expect(res.data!.generatedAt).toBe(clock.nowIso());
  });

  it("returns real section keys — not the Phase 1A placeholder shape", async () => {
    // REGRESSION: the contract used to declare TodayGroupKey values
    // ("today_tasks", "no_progress", "new_ftd") that the builder never produced,
    // so the provider cast `key: q.code as never`. Nothing may cast now.
    const res = await provider.getTodayWorkspace(ctx("crm_admin"), {});
    for (const section of res.data!.sections) {
      expect(TODAY_SECTION_ORDER).toContain(section.key);
      expect(section.title.length).toBeGreaterThan(0);
    }
  });

  it("carries the caller's role through to the projection", async () => {
    for (const role of CRM_ROLES) {
      const res = await provider.getTodayWorkspace(ctx(role), {});
      expect(res.data!.role).toBe(role);
    }
  });

  it("gives every item what triage needs", async () => {
    const res = await provider.getTodayWorkspace(ctx("crm_admin"), {});
    const items = res.data!.sections.flatMap((s) => s.items);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.userId).toMatch(/^usr_mock_/);
      expect(item.identity.mode).toBeTruthy();
      expect(item.priority).toBeTruthy();
      expect(item.basis.text.length).toBeGreaterThan(0);
      expect(item.section).toBe(
        res.data!.sections.find((s) => s.items.includes(item))!.key,
      );
    }
  });

  it("applies filters and sort passed through the input", async () => {
    const all = await provider.getTodayWorkspace(ctx("crm_admin"), {});
    const filtered = await provider.getTodayWorkspace(ctx("crm_admin"), {
      filters: { priority: ["critical"] },
    });
    expect(filtered.data!.summary.totalAttention).toBeLessThan(all.data!.summary.totalAttention);

    const sorted = await provider.getTodayWorkspace(ctx("crm_admin"), { sort: "last_activity" });
    expect(sorted.status).toBe("ok");
  });

  it("is deterministic across calls", async () => {
    const a = await provider.getTodayWorkspace(ctx("crm_admin"), {});
    const b = await provider.getTodayWorkspace(ctx("crm_admin"), {});
    expect(a.data).toEqual(b.data);
  });
});

describe("getTodayWorkspace — modes", () => {
  it("error mode fails through Result with a retriable error", async () => {
    const p = new MockCrmDataProvider({ clock, errorMode: true });
    const res = await p.getTodayWorkspace(ctx("crm_admin"), {});
    expect(res.status).toBe("error");
    expect(res.data).toBeNull();
    expect(res.error!.retriable).toBe(true);
  });

  it("stale mode keeps the queue usable and marks it stale", async () => {
    const p = new MockCrmDataProvider({ clock, staleMode: true });
    const res = await p.getTodayWorkspace(ctx("crm_admin"), {});
    expect(res.status).toBe("stale");
    expect(res.data!.sections.length).toBeGreaterThan(0);
    expect(res.data!.freshness.isStale).toBe(true);
    expect(res.data!.freshness.ageMinutes).toBeGreaterThan(0);
    expect(res.freshness!.isStale).toBe(true);
  });

  it("empty mode returns an empty queue that is not an error", async () => {
    const p = new MockCrmDataProvider({ clock, emptyMode: true });
    const res = await p.getTodayWorkspace(ctx("crm_admin"), {});
    expect(res.status).toBe("empty");
    expect(res.data!.sections).toEqual([]);
    expect(res.data!.summary.totalAttention).toBe(0);
    // No users at all → nothing calm either; the UI must not claim otherwise.
    expect(res.data!.hasCalmUsers).toBe(false);
    expect(res.error).toBeNull();
  });
});

describe("getTodayWorkspace — read-only", () => {
  /**
   * Today still has no mutating counterpart — but the check can no longer be
   * "the provider has no mutator at all", which only held while none existed.
   * Phase 1B4-C added `assignPrimaryOwner`, 1B4-D added `setNotePinned`, 1B4-E added
   * `updateNoteBody`, 1B5-C added `setNoteVisibility` and 1B6 added `deleteNote`, all
   * of which belong to User 360. So the allowed set is named explicitly: a new mutator
   * has to be admitted here on purpose, and none of them may be a Today operation.
   */
  it("has no mutating counterpart on the contract", () => {
    const ops = Object.getOwnPropertyNames(MockCrmDataProvider.prototype);
    const mutators = ops.filter((o) => /^(create|update|assign|close|complete|resolve|delete|set)/i.test(o));
    expect(mutators.sort()).toEqual([
      "assignPrimaryOwner",
      "deleteNote",
      "setNotePinned",
      "setNoteVisibility",
      "updateNoteBody",
    ]);
    expect(mutators.filter((o) => /today/i.test(o))).toEqual([]);
  });

  it("does not mutate the dataset between calls", async () => {
    const before = await provider.getTodayWorkspace(ctx("crm_admin"), {});
    await provider.getTodayWorkspace(ctx("support"), { filters: { priority: ["critical"] } });
    const after = await provider.getTodayWorkspace(ctx("crm_admin"), {});
    expect(after.data).toEqual(before.data);
  });
});
