import { describe, expect, it } from "vitest";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";
import type { CrmRole } from "@/domain/identity/roles";
import { CRM_ROLES } from "@/domain/identity/roles";
import { buildDataset } from "@/data/mock/fixtures/build";
import { buildUserTimeline, buildProjectedUserTimeline } from "./user-timeline";

const clock = new FixedMockClock();
const provider = new MockCrmDataProvider({ clock, delayMs: 0 });
const ctx = (role: CrmRole): CrmContext => ({ actorId: "emp_test", role, now: clock.nowIso() });

/** Nina Chmiel — has a confirmed FTD ($90) → a HIGH financial event exists. */
const WITH_DEPOSIT = "usr_mock_026";
/** Ilya Wrona — FTD + a redeposit → several HIGH events. */
const WITH_REDEPOSITS = "usr_mock_027";
/** Nadia Novak — never deposited → no HIGH events at all. */
const NO_DEPOSIT = "usr_mock_001";

const users = buildDataset(clock);
const userById = (id: string) => users.find((u) => u.identity.userId === id)!;

/** Roles that may see exact financials (ROLE_PERMISSION_MATRIX §4.1). */
const FINANCIAL_ROLES: CrmRole[] = ["crm_admin", "crm_manager", "retention_manager"];
const NON_FINANCIAL_ROLES: CrmRole[] = CRM_ROLES.filter((r) => !FINANCIAL_ROLES.includes(r));

async function timelineFor(role: CrmRole, userId = WITH_DEPOSIT) {
  const res = await provider.getUserTimeline(ctx(role), { userId, page: { pageSize: 100 } });
  return res;
}

const HIGH_KINDS = ["first_deposit_confirmed", "redeposit_confirmed_1", "redeposit_confirmed_2"];

describe("timeline projector — canonical build", () => {
  it("marks only confirmed money movements as HIGH", () => {
    const entries = buildUserTimeline(userById(WITH_REDEPOSITS));
    const high = entries.filter((e) => e.sensitivity === "HIGH").map((e) => e.kind);
    expect(high).toContain("first_deposit_confirmed");
    expect(high).toContain("redeposit_confirmed_1");
    // Status changes and learning events are not financial data.
    const low = entries.filter((e) => e.sensitivity !== "HIGH").map((e) => e.kind);
    expect(low).toContain("registered");
    expect(low).not.toContain("first_deposit_confirmed");
  });

  it("never puts a monetary amount into any event field", () => {
    for (const u of users) {
      for (const e of buildUserTimeline(u)) {
        const serialized = JSON.stringify(e);
        // A withheld event must not be reconstructable from a permitted one,
        // so no event may carry an amount in title/summary/kind/id.
        expect(serialized).not.toMatch(/\$\s?\d/);
        expect(e.summary).toBeNull();
      }
      // Cross-check against the user's real amounts.
      const amounts = [
        u.financial.balanceUsd,
        u.financial.netDepositsUsd,
        u.financial.ftd?.amountUsd,
        ...u.financial.redeposits.map((r) => r.amountUsd),
      ].filter((n): n is number => typeof n === "number" && n > 0);
      const serialized = JSON.stringify(buildUserTimeline(u));
      for (const amount of amounts) {
        expect(serialized).not.toContain(`$${amount}`);
      }
    }
  });

  it("gives every event a unique id even with several redeposits", () => {
    const entries = buildUserTimeline(userById(WITH_REDEPOSITS));
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is deterministic and sorted newest-first", () => {
    const a = buildUserTimeline(userById(WITH_DEPOSIT));
    const b = buildUserTimeline(userById(WITH_DEPOSIT));
    expect(a).toEqual(b);
    const times = a.map((e) => e.at);
    expect([...times]).toEqual([...times].sort((x, y) => (x < y ? 1 : x > y ? -1 : 0)));
  });
});

describe("getUserTimeline — permission context is honoured", () => {
  /**
   * REGRESSION: the old implementation took `_ctx` and ignored it, so every
   * role received the HIGH deposit events. This fails against that version.
   */
  it("the provider context changes the result", async () => {
    const asAdmin = await timelineFor("crm_admin");
    const asSupport = await timelineFor("support");
    expect(asAdmin.data!.items).not.toEqual(asSupport.data!.items);
    expect(asSupport.data!.items.length).toBeLessThan(asAdmin.data!.items.length);
  });

  it.each(FINANCIAL_ROLES)("%s (may see exact financials) receives HIGH events", async (role) => {
    const res = await timelineFor(role);
    const kinds = res.data!.items.map((e) => e.kind);
    expect(kinds).toContain("first_deposit_confirmed");
    expect(res.data!.items.some((e) => e.sensitivity === "HIGH")).toBe(true);
  });

  it.each(NON_FINANCIAL_ROLES)("%s (no financial access) receives NO HIGH events", async (role) => {
    const res = await timelineFor(role);
    const items = res.data!.items;
    expect(items.every((e) => e.sensitivity !== "HIGH")).toBe(true);
    for (const kind of HIGH_KINDS) {
      expect(items.map((e) => e.kind)).not.toContain(kind);
    }
    // Silently withheld — no placeholder advertises that money events exist.
    expect(JSON.stringify(items)).not.toContain("депозит");
  });

  it.each(NON_FINANCIAL_ROLES)("%s: no amount is reconstructable from the result", async (role) => {
    const res = await timelineFor(role);
    const serialized = JSON.stringify(res);
    // usr_mock_026: balance and FTD are both $90.
    expect(serialized).not.toContain("90");
    expect(serialized).not.toMatch(/\$\s?\d/);
  });

  it.each(NON_FINANCIAL_ROLES)("%s still receives non-financial events", async (role) => {
    const res = await timelineFor(role);
    const kinds = res.data!.items.map((e) => e.kind);
    expect(kinds).toContain("registered");
    expect(res.data!.items.length).toBeGreaterThan(0);
  });

  it("withholds every redeposit, not just the first", async () => {
    const res = await timelineFor("support", WITH_REDEPOSITS);
    expect(res.data!.items.every((e) => !e.kind.startsWith("redeposit_"))).toBe(true);
    const admin = await timelineFor("crm_admin", WITH_REDEPOSITS);
    expect(admin.data!.items.some((e) => e.kind.startsWith("redeposit_"))).toBe(true);
  });

  it("returns identical results for a user with no financial events", async () => {
    const asAdmin = await timelineFor("crm_admin", NO_DEPOSIT);
    const asSupport = await timelineFor("support", NO_DEPOSIT);
    // Nothing HIGH exists → permission makes no difference.
    expect(asSupport.data!.items).toEqual(asAdmin.data!.items);
  });
});

describe("getUserTimeline — contract behaviour preserved", () => {
  it("keeps a stable order for every role", async () => {
    for (const role of CRM_ROLES) {
      const res = await timelineFor(role);
      const times = res.data!.items.map((e) => e.at);
      expect([...times]).toEqual([...times].sort((x, y) => (x < y ? 1 : x > y ? -1 : 0)));
    }
  });

  it("paginates, and the limit applies after projection", async () => {
    const page1 = await provider.getUserTimeline(ctx("crm_admin"), {
      userId: WITH_DEPOSIT,
      page: { pageSize: 2 },
    });
    expect(page1.data!.items).toHaveLength(2);
    expect(page1.data!.page.nextCursor).toBe("2");

    const page2 = await provider.getUserTimeline(ctx("crm_admin"), {
      userId: WITH_DEPOSIT,
      page: { cursor: "2", pageSize: 2 },
    });
    expect(page2.data!.items[0]?.id).not.toBe(page1.data!.items[0]?.id);

    // The total a role sees reflects what that role may see.
    const supportAll = await timelineFor("support");
    expect(supportAll.data!.page.total).toBe(supportAll.data!.items.length);
  });

  it("filters by source", async () => {
    const res = await provider.getUserTimeline(ctx("crm_admin"), {
      userId: WITH_DEPOSIT,
      sources: ["product"],
      page: { pageSize: 100 },
    });
    expect(res.data!.items.every((e) => e.source === "product")).toBe(true);
    expect(res.data!.items.length).toBeGreaterThan(0);
  });

  it("unknown user still returns an empty page, not an error", async () => {
    const res = await provider.getUserTimeline(ctx("crm_admin"), { userId: "usr_nope" });
    expect(res.status).toBe("empty");
    expect(res.data!.items).toEqual([]);
    expect(res.error).toBeNull();
  });

  it("timestamps come from the provider clock, not the wall clock", async () => {
    const res = await timelineFor("crm_admin");
    const registered = res.data!.items.find((e) => e.kind === "registered")!;
    expect(registered.at).toBe(userById(WITH_DEPOSIT).identity.registeredAt);
    expect(registered.at).toBe("2026-06-13T09:00:00.000Z");
  });
});

describe("timeline and User 360 share one projection policy", () => {
  it.each(CRM_ROLES)("%s sees the same events in both operations", async (role) => {
    const timeline = await timelineFor(role);
    const view = await provider.getUser360(ctx(role), { userId: WITH_DEPOSIT });

    const timelineKinds = timeline.data!.items.map((e) => e.kind).sort();
    const activityKinds = view.data!.activity.map((e) => e.kind).sort();
    expect(activityKinds).toEqual(timelineKinds);
  });

  it("both operations build from the same canonical projector", async () => {
    const expected = buildProjectedUserTimeline(userById(WITH_DEPOSIT), "support").map((e) => e.id);
    const timeline = await timelineFor("support");
    const view = await provider.getUser360(ctx("support"), { userId: WITH_DEPOSIT });
    expect(timeline.data!.items.map((e) => e.id)).toEqual(expected);
    expect(view.data!.activity.map((e) => e.id)).toEqual(expected);
  });
});
