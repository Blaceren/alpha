import { describe, expect, it } from "vitest";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import type { CrmContext, GetTimelineInput } from "@/data/contracts/CrmDataProvider";
import type { CrmRole } from "@/domain/identity/roles";
import { CRM_ROLES } from "@/domain/identity/roles";
import { buildDataset } from "@/data/mock/fixtures/build";
import { buildUserTimeline, buildProjectedUserTimeline, parseTimelineRange } from "./user-timeline";

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

describe("getUserTimeline — from/to range (Phase 1B3 debt)", () => {
  /** Every event of usr_mock_026, newest-first, as the admin sees them. */
  async function adminEvents(extra: Partial<GetTimelineInput> = {}) {
    const res = await provider.getUserTimeline(ctx("crm_admin"), {
      userId: WITH_DEPOSIT,
      page: { pageSize: 100 },
      ...extra,
    });
    return res;
  }

  /**
   * REGRESSION: the previous implementation accepted `from`/`to` and ignored
   * them, returning the full timeline for any window. Each test below fails
   * against that version.
   */
  it("applies `from` alone as an inclusive lower bound", async () => {
    const all = await adminEvents();
    const times = all.data!.items.map((e) => Date.parse(e.at)).sort((a, b) => a - b);
    const cutoff = times[2]!; // drop the two oldest events

    const res = await adminEvents({ from: new Date(cutoff).toISOString() });
    expect(res.data!.items.length).toBeLessThan(all.data!.items.length);
    expect(res.data!.items.every((e) => Date.parse(e.at) >= cutoff)).toBe(true);
  });

  it("applies `to` alone as an inclusive upper bound", async () => {
    const all = await adminEvents();
    const times = all.data!.items.map((e) => Date.parse(e.at)).sort((a, b) => a - b);
    const cutoff = times[1]!;

    const res = await adminEvents({ to: new Date(cutoff).toISOString() });
    expect(res.data!.items.length).toBeLessThan(all.data!.items.length);
    expect(res.data!.items.every((e) => Date.parse(e.at) <= cutoff)).toBe(true);
  });

  it("applies `from` + `to` together", async () => {
    const all = await adminEvents();
    const times = all.data!.items.map((e) => Date.parse(e.at)).sort((a, b) => a - b);
    const from = times[1]!;
    const to = times[times.length - 2]!;

    const res = await adminEvents({
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    });
    expect(res.data!.items.every((e) => Date.parse(e.at) >= from && Date.parse(e.at) <= to)).toBe(true);
    expect(res.data!.items.length).toBeGreaterThan(0);
    expect(res.data!.items.length).toBeLessThan(all.data!.items.length);
  });

  it("KEEPS an event sitting exactly on either boundary (both bounds inclusive)", async () => {
    const all = await adminEvents();
    const oldest = all.data!.items[all.data!.items.length - 1]!;
    const newest = all.data!.items[0]!;

    // A window closed exactly on the two extreme events keeps both.
    const res = await adminEvents({ from: oldest.at, to: newest.at });
    expect(res.data!.items.map((e) => e.id)).toEqual(all.data!.items.map((e) => e.id));

    // A degenerate window from==to keeps exactly the event at that instant.
    const pin = await adminEvents({ from: newest.at, to: newest.at });
    expect(pin.data!.items.map((e) => e.id)).toEqual([newest.id]);
  });

  it("compares instants, not strings (ISO spellings of the same instant agree)", async () => {
    const withMs = await adminEvents({ from: "2026-06-13T09:00:00.000Z" });
    const withoutMs = await adminEvents({ from: "2026-06-13T09:00:00Z" });
    expect(withoutMs.data!.items.map((e) => e.id)).toEqual(withMs.data!.items.map((e) => e.id));
  });

  it("an empty window returns an empty page, not an error", async () => {
    const res = await adminEvents({ from: "2030-01-01T00:00:00.000Z", to: "2030-01-02T00:00:00.000Z" });
    expect(res.status).toBe("empty");
    expect(res.data!.items).toEqual([]);
    expect(res.data!.page.total).toBe(0);
    expect(res.error).toBeNull();
  });

  it("an inverted range fails through Result, never throws", async () => {
    const call = provider.getUserTimeline(ctx("crm_admin"), {
      userId: WITH_DEPOSIT,
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-06-01T00:00:00.000Z",
    });
    await expect(call).resolves.toBeDefined(); // no throw reaches the UI
    const res = await call;
    expect(res.status).toBe("error");
    expect(res.data).toBeNull();
    expect(res.error!.code).toBe("invalid_input");
    expect(res.error!.retriable).toBe(false);
  });

  it("an unparseable bound fails as invalid_input", async () => {
    for (const bad of [{ from: "yesterday" }, { to: "not-a-date" }]) {
      const res = await provider.getUserTimeline(ctx("crm_admin"), { userId: WITH_DEPOSIT, ...bad });
      expect(res.status).toBe("error");
      expect(res.error!.code).toBe("invalid_input");
    }
  });

  it("rejects a bad range identically for known and unknown users (no existence leak)", async () => {
    const known = await provider.getUserTimeline(ctx("crm_admin"), {
      userId: WITH_DEPOSIT,
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-06-01T00:00:00.000Z",
    });
    const unknown = await provider.getUserTimeline(ctx("crm_admin"), {
      userId: "usr_nope",
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-06-01T00:00:00.000Z",
    });
    expect(unknown.status).toBe(known.status);
    expect(unknown.error!.code).toBe(known.error!.code);
  });

  it("range narrows permission projection — it never widens it", async () => {
    // A window wide enough to contain the FTD still yields no HIGH event for a
    // role that may not see money movements.
    const wide = { from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T00:00:00.000Z", page: { pageSize: 100 } };
    const support = await provider.getUserTimeline(ctx("support"), { userId: WITH_DEPOSIT, ...wide });
    const admin = await provider.getUserTimeline(ctx("crm_admin"), { userId: WITH_DEPOSIT, ...wide });

    expect(support.data!.items.every((e) => e.sensitivity !== "HIGH")).toBe(true);
    expect(support.data!.items.map((e) => e.kind)).not.toContain("first_deposit_confirmed");
    expect(admin.data!.items.map((e) => e.kind)).toContain("first_deposit_confirmed");
    // `total` reflects only what the role may see inside the window.
    expect(support.data!.page.total).toBe(support.data!.items.length);
    expect(support.data!.page.total!).toBeLessThan(admin.data!.page.total!);
  });

  it("applies the limit AFTER the range, not before", async () => {
    const all = await adminEvents();
    const times = all.data!.items.map((e) => Date.parse(e.at)).sort((a, b) => a - b);
    const from = new Date(times[1]!).toISOString();

    const inRange = await adminEvents({ from });
    expect(inRange.data!.items.length).toBeGreaterThan(1);

    const limited = await provider.getUserTimeline(ctx("crm_admin"), {
      userId: WITH_DEPOSIT,
      from,
      page: { pageSize: 1 },
    });
    // Page 1 of the RANGED list — had the limit been applied first, the page
    // would have been cut from the full list and then emptied by the filter.
    expect(limited.data!.items).toHaveLength(1);
    expect(limited.data!.items[0]!.id).toBe(inRange.data!.items[0]!.id);
    expect(limited.data!.page.total).toBe(inRange.data!.items.length);
  });

  it("keeps range results deterministic and newest-first", async () => {
    const window = { from: "2026-06-01T00:00:00.000Z", to: "2026-07-13T09:00:00.000Z" };
    const a = await adminEvents(window);
    const b = await adminEvents(window);
    expect(a.data!.items).toEqual(b.data!.items);
    const times = a.data!.items.map((e) => e.at);
    expect([...times]).toEqual([...times].sort((x, y) => (x < y ? 1 : x > y ? -1 : 0)));
  });

  it("combines with the source filter", async () => {
    const res = await adminEvents({
      sources: ["product"],
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-12-31T00:00:00.000Z",
    });
    expect(res.data!.items.every((e) => e.source === "product")).toBe(true);
    expect(res.data!.items.length).toBeGreaterThan(0);
  });
});

describe("parseTimelineRange — pure resolver", () => {
  it("treats omitted bounds as unbounded", () => {
    const r = parseTimelineRange(undefined, undefined);
    expect(r).toEqual({ ok: true, range: { fromMs: -Infinity, toMs: Infinity } });
  });

  it("accepts an equal from/to (a single instant)", () => {
    const r = parseTimelineRange("2026-07-13T09:00:00.000Z", "2026-07-13T09:00:00.000Z");
    expect(r.ok).toBe(true);
  });

  it("names why a range was rejected", () => {
    expect(parseTimelineRange("nope", undefined)).toEqual({ ok: false, reason: "invalid_from" });
    expect(parseTimelineRange(undefined, "nope")).toEqual({ ok: false, reason: "invalid_to" });
    expect(parseTimelineRange("2026-07-02T00:00:00.000Z", "2026-07-01T00:00:00.000Z")).toEqual({
      ok: false,
      reason: "inverted_range",
    });
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
