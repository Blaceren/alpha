import { describe, expect, it } from "vitest";
import { FixedMockClock } from "@/lib/clock";
import { buildDataset } from "@/data/mock/fixtures/build";
import { CRM_ROLES, type CrmRole } from "@/domain/identity/roles";
import {
  QUEUES_WITHOUT_FINANCIALS,
  TODAY_ATTENTION_BASES,
  TODAY_BASES_WITH_FINANCIALS,
  TODAY_DERIVED_BASES,
  TODAY_QUEUE_ORDER,
  TODAY_SECTION_ORDER,
  TODAY_SEGMENT_BASES,
} from "@/config/queues";
import { PRIORITY_REASON_LABEL, RECOMMENDATION_LABEL } from "@/config/labels";
import { buildTodayWorkspace, operationalWindow } from "./builder";
import type { TodayQuery } from "./today-query";
import type { TodayQueueItem } from "./today";

const clock = new FixedMockClock();
const users = buildDataset(clock);

const build = (role: CrmRole = "crm_admin", query?: TodayQuery) =>
  buildTodayWorkspace({ users, clock, role, query });

const itemsOf = (role: CrmRole = "crm_admin", query?: TodayQuery): TodayQueueItem[] =>
  build(role, query).sections.flatMap((s) => s.items);

/** usr_mock_026 — support-blocked + breached SLA + checkpoint. */
const SUPPORT_BLOCKED = "usr_mock_026";

describe("Today — queue membership", () => {
  it("admits a user only on a real attention basis", () => {
    const ws = build();
    for (const item of ws.sections.flatMap((s) => s.items)) {
      expect(TODAY_ATTENTION_BASES).toContain(item.basis.code);
    }
    expect(ws.summary.totalAttention).toBeGreaterThan(0);
  });

  it("keeps calm users out of the queue entirely", () => {
    // These fixtures produce no signals at all — nothing needs doing today.
    const calm = ["usr_mock_004", "usr_mock_005", "usr_mock_016", "usr_mock_017"];
    const ids = itemsOf().map((i) => i.userId);
    for (const id of calm) expect(ids).not.toContain(id);
    expect(build().hasCalmUsers).toBe(true);
  });

  it("does not admit a user on a value segment alone", () => {
    // repeat_funders / new_funded_users describe WHO a user is, not what needs
    // doing — a repeat funder with no blocker must not occupy the queue.
    const ids = itemsOf().map((i) => i.userId);
    for (const id of ids) {
      const item = itemsOf().find((i) => i.userId === id)!;
      const all = [item.basis.code, ...item.additionalBasisCodes];
      expect(all.some((b) => TODAY_ATTENTION_BASES.includes(b))).toBe(true);
    }
    // The segment codes never appear as a visible basis.
    for (const item of itemsOf()) {
      expect(TODAY_SEGMENT_BASES).not.toContain(item.basis.code);
      for (const b of item.additionalBasisCodes) expect(TODAY_SEGMENT_BASES).not.toContain(b);
    }
  });

  it("still covers the onboarding users 001/002/003 (D-24 preserved)", () => {
    const ids = itemsOf().map((i) => i.userId);
    expect(ids).toContain("usr_mock_001");
    expect(ids).toContain("usr_mock_002");
    expect(ids).toContain("usr_mock_003");
  });

  it("every item states a concrete reason, never a bare «требует внимания»", () => {
    for (const item of itemsOf()) {
      expect(item.basis.text.length).toBeGreaterThan(0);
      expect(item.basis.text).not.toMatch(/^требует внимания$/i);
      expect(item.basis.text).toMatch(/[А-Яа-яЁё]/);
      // Never a raw code.
      expect(item.basis.text).not.toContain("_");
    }
  });
});

describe("Today — a row states each fact once (§10)", () => {
  it("carries the priority rule for the record, though the row does not print it", () => {
    // The ladder and the bases read the same signal catalog, so the reason label
    // would only restate the basis on screen. The DATA still says which rule
    // ranked the user — parity with UserSummary.priorityReasonCode.
    for (const item of itemsOf()) {
      expect(item.priorityReasonCode.length).toBeGreaterThan(0);
      expect(PRIORITY_REASON_LABEL[item.priorityReasonCode]).toBeTruthy();
    }
    const nina = itemsOf().find((i) => i.userId === SUPPORT_BLOCKED)!;
    expect(nina.priorityReasonCode).toBe("critical_support_issue");
    expect(nina.basis.signalCode).toBe("support_blocked");
  });

  it("never repeats a derived basis as a reason chip", () => {
    for (const item of itemsOf()) {
      for (const code of item.additionalBasisCodes) {
        // critical_attention → the priority badge says it.
        // sla_breached / due_today → the due chip says it, with the timing.
        expect(TODAY_DERIVED_BASES.has(code)).toBe(false);
      }
    }
  });

  it("prefers a substantive headline over a deadline restatement", () => {
    // usr_mock_029 holds sla_breached AND a data conflict. The chip carries the
    // deadline, so the reason should carry the substance behind it.
    const rita = itemsOf().find((i) => i.userId === "usr_mock_029")!;
    expect(rita.due?.state).toBe("breached");
    expect(rita.basis.code).not.toBe("sla_breached");
    expect(rita.basis.text).not.toMatch(/срок|просрочен/i);
  });

  it("never restates the deadline timing inside the reason text", () => {
    // The due chip owns "просрочен 6 ч" / "через 4 ч".
    for (const item of itemsOf().filter((i) => i.due)) {
      expect(item.basis.text).not.toMatch(/Срок прошёл|Срок наступает через/);
    }
  });

  it("never puts an evidence figure the reason already quoted", () => {
    for (const item of itemsOf()) {
      for (const e of item.evidence) {
        expect(e.kind).toBe("metric"); // references only confirm, never add
        if (typeof e.value === "number") {
          expect(item.basis.text).not.toMatch(new RegExp(`(^|\\D)${e.value}(\\D|$)`));
        }
      }
    }
  });
});

describe("Today — canonical placement", () => {
  it("puts each user in exactly ONE section", () => {
    const ws = build();
    const ids = ws.sections.flatMap((s) => s.items.map((i) => i.userId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("orders sections most-urgent first and never returns an empty section", () => {
    const ws = build();
    const keys = ws.sections.map((s) => s.key);
    expect(keys).toEqual(TODAY_SECTION_ORDER.filter((k) => keys.includes(k)));
    for (const s of ws.sections) expect(s.items.length).toBeGreaterThan(0);
  });

  it("places a passed deadline in `overdue`, above critical", () => {
    const ws = build();
    const overdue = ws.sections.find((s) => s.key === "overdue");
    expect(overdue).toBeDefined();
    for (const item of overdue!.items) {
      expect(item.due).not.toBeNull();
      expect(item.due!.at <= clock.nowIso()).toBe(true);
    }
    // usr_mock_026 is critical AND breached → overdue wins, but the critical
    // badge is preserved, so nothing is hidden by the placement.
    const nina = overdue!.items.find((i) => i.userId === SUPPORT_BLOCKED);
    expect(nina).toBeDefined();
    expect(nina!.priority).toBe("critical");
  });

  it("places critical-but-not-overdue in `critical_now`", () => {
    const ws = build();
    const critical = ws.sections.find((s) => s.key === "critical_now");
    if (critical) {
      for (const item of critical.items) {
        expect(item.priority).toBe("critical");
        // Not overdue: either no deadline, or one still ahead.
        if (item.due) expect(item.due.at > clock.nowIso()).toBe(true);
      }
    }
  });

  it("places low-urgency-but-grounded users in `watch`", () => {
    const watch = build().sections.find((s) => s.key === "watch");
    expect(watch).toBeDefined();
    for (const item of watch!.items) {
      expect(["normal", "low"]).toContain(item.priority);
    }
  });

  it("never shows the same user twice across a filtered view either", () => {
    const ids = itemsOf("crm_admin", { filters: { priority: ["critical", "high"] } }).map((i) => i.userId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Today — sorting", () => {
  it("is deterministic: same input, identical output", () => {
    expect(build()).toEqual(build());
  });

  it("defaults to urgency and never uses randomness or the wall clock", () => {
    const a = itemsOf("crm_admin", { sort: "urgency" });
    const b = itemsOf("crm_admin");
    expect(a.map((i) => i.userId)).toEqual(b.map((i) => i.userId));
  });

  it("orders by priority band within a section", () => {
    const rank = { critical: 0, high: 1, normal: 2, low: 3 } as const;
    for (const s of build().sections) {
      const ranks = s.items.map((i) => rank[i.priority]);
      expect([...ranks]).toEqual([...ranks].sort((x, y) => x - y));
    }
  });

  it("`last_activity` puts the stalest user first", () => {
    const items = itemsOf("crm_admin", { sort: "last_activity" });
    const ages = items
      .filter((i) => i.section === "watch" && i.lastActivityAt)
      .map((i) => new Date(i.lastActivityAt!).getTime());
    expect([...ages]).toEqual([...ages].sort((a, b) => a - b));
  });

  it("`owner` groups by owner and sorts unassigned last", () => {
    const items = itemsOf("crm_admin", { sort: "owner" }).filter((i) => i.section === "watch");
    const owners = items.map((i) => i.ownerId);
    const firstNull = owners.indexOf(null);
    if (firstNull !== -1) expect(owners.slice(firstNull).every((o) => o === null)).toBe(true);
  });

  it("a manual sort cannot move a critical user out of its section", () => {
    for (const sort of ["urgency", "last_activity", "owner"] as const) {
      const ws = build("crm_admin", { sort });
      const critical = ws.sections
        .flatMap((s) => s.items)
        .filter((i) => i.priority === "critical")
        .map((i) => i.section);
      // Critical users stay in overdue/critical_now regardless of sort choice.
      for (const section of critical) expect(["overdue", "critical_now"]).toContain(section);
    }
  });
});

describe("Today — summary", () => {
  it("counts the CURRENT queue", () => {
    const ws = build();
    const items = ws.sections.flatMap((s) => s.items);
    expect(ws.summary.totalAttention).toBe(items.length);
    expect(ws.summary.critical).toBe(items.filter((i) => i.priority === "critical").length);
    expect(ws.summary.slaBreached).toBe(items.filter((i) => i.due?.state === "breached").length);
    expect(ws.summary.unassigned).toBe(items.filter((i) => i.ownerId === null).length);
  });

  it("follows the filters", () => {
    const all = build();
    const filtered = build("crm_admin", { filters: { priority: ["critical"] } });
    expect(filtered.summary.totalAttention).toBeLessThan(all.summary.totalAttention);
    expect(filtered.summary.totalAttention).toBe(filtered.summary.critical);
  });

  it("carries no financial figure", () => {
    const serialized = JSON.stringify(build().summary);
    expect(serialized).not.toMatch(/\$\s?\d/);
  });
});

describe("Today — filters", () => {
  it("filters by priority", () => {
    const items = itemsOf("crm_admin", { filters: { priority: ["critical"] } });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.priority === "critical")).toBe(true);
  });

  it("filters by basis, matching ANY of a user's bases", () => {
    const items = itemsOf("crm_admin", { filters: { basis: ["support_blockers"] } });
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect([item.basis.code, ...item.additionalBasisCodes]).toContain("support_blockers");
    }
  });

  it("filters by owner and by unassigned", () => {
    const unassigned = itemsOf("crm_admin", { filters: { ownerId: "unassigned" } });
    expect(unassigned.every((i) => i.ownerId === null)).toBe(true);

    const owner = build().filterOptions.owners[0]!;
    const owned = itemsOf("crm_admin", { filters: { ownerId: [owner] } });
    expect(owned.length).toBeGreaterThan(0);
    expect(owned.every((i) => i.ownerId === owner)).toBe(true);
  });

  it("filters by SLA state", () => {
    const items = itemsOf("crm_admin", { filters: { sla: ["breached"] } });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.due?.state === "breached")).toBe(true);
  });

  it("filters by section", () => {
    const items = itemsOf("crm_admin", { filters: { section: ["overdue"] } });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.section === "overdue")).toBe(true);
  });

  it("returns an empty queue (not an error) when filters match nothing", () => {
    const ws = build("crm_admin", { filters: { query: "zzz-nothing-matches" } });
    expect(ws.sections).toEqual([]);
    expect(ws.summary.totalAttention).toBe(0);
  });

  it("offers no dead filter: every option returns at least one user", () => {
    // The real invariant is that APPLYING an option produces results — not that
    // the option is visible on a row. `sla_breached` is a legitimate filter even
    // though the row shows the deadline as a chip instead of a reason.
    const ws = build();

    for (const p of ws.filterOptions.priority) {
      expect(itemsOf("crm_admin", { filters: { priority: [p] } }).length).toBeGreaterThan(0);
    }
    for (const b of ws.filterOptions.basis) {
      expect(TODAY_QUEUE_ORDER).toContain(b);
      expect(itemsOf("crm_admin", { filters: { basis: [b] } }).length).toBeGreaterThan(0);
    }
    for (const o of ws.filterOptions.owners) {
      expect(itemsOf("crm_admin", { filters: { ownerId: [o] } }).length).toBeGreaterThan(0);
    }
    if (ws.filterOptions.hasUnassigned) {
      expect(itemsOf("crm_admin", { filters: { ownerId: "unassigned" } }).length).toBeGreaterThan(0);
    }
  });

  it("can filter by a derived basis even though the row shows it as a chip elsewhere", () => {
    const items = itemsOf("crm_admin", { filters: { basis: ["sla_breached"] } });
    expect(items.length).toBeGreaterThan(0);
    // Every match really does have a breached deadline…
    expect(items.every((i) => i.due?.state === "breached")).toBe(true);
    // …while none of them repeats it as a reason chip (§10).
    expect(items.every((i) => !i.additionalBasisCodes.includes("sla_breached"))).toBe(true);
  });

  it("options stay stable while filters narrow the queue", () => {
    const all = build().filterOptions;
    const filtered = build("crm_admin", { filters: { priority: ["critical"] } }).filterOptions;
    // Options describe the role's whole queue, so the controls do not vanish
    // as soon as you use them.
    expect(filtered).toEqual(all);
  });
});

describe("Today — operational window (§21)", () => {
  it("runs from the start of the working day to the provider clock's now", () => {
    const w = operationalWindow(clock);
    expect(w.from).toBe("2026-07-13T00:00:00.000Z");
    expect(w.to).toBe("2026-07-13T09:00:00.000Z");
    expect(build().window).toEqual(w);
  });

  it("reports a today event only when it happened inside the window", () => {
    for (const item of itemsOf()) {
      if (item.todayEvent) {
        expect(item.todayEvent.at >= "2026-07-13T00:00:00.000Z").toBe(true);
        expect(item.todayEvent.at <= "2026-07-13T09:00:00.000Z").toBe(true);
      }
    }
  });

  it("keeps an older blocker in the queue — membership is state, not the window", () => {
    // The support blocker on usr_mock_026 was not raised today, yet the user is
    // still the most critical thing in the queue: an active blocker is current
    // STATE, so it is never aged out by the window.
    const item = itemsOf().find((i) => i.userId === SUPPORT_BLOCKED)!;
    expect(item).toBeDefined();
    expect(item.basis.code).toBe("support_blockers");
    expect(item.section).toBe("overdue");

    // And membership does not require a today event at all: plenty of queued
    // users did nothing today.
    const silentToday = itemsOf().filter((i) => i.todayEvent === null);
    expect(silentToday.length).toBeGreaterThan(0);
  });

  it("separates current state from a recent event", () => {
    const stale = itemsOf().find((i) => i.lastActivityAt && i.lastActivityAt < "2026-07-13T00:00:00.000Z");
    expect(stale).toBeDefined();
    // lastActivityAt is absolute (may be days old); todayEvent is window-bound.
    expect(stale!.todayEvent).toBeNull();
  });
});

describe("Today — freshness", () => {
  it("computes age from the provider clock, not the wall clock", () => {
    const f = build().freshness;
    expect(f.generatedAt).toBe(clock.nowIso());
    expect(f.ageMinutes).toBe(Math.round((clock.nowMs() - new Date(f.asOf).getTime()) / 60_000));
    expect(f.ageMinutes).toBeGreaterThanOrEqual(0);
    expect(f.isStale).toBe(false);
  });

  it("marks stale when asked, keeping the queue readable", () => {
    const ws = buildTodayWorkspace({ users, clock, role: "crm_admin", staleMode: true });
    expect(ws.freshness.isStale).toBe(true);
    expect(ws.freshness.ageMinutes).toBeGreaterThan(0);
    // The queue stays available — stale data is still the best data we have.
    expect(ws.sections.length).toBeGreaterThan(0);
    expect(ws.summary.totalAttention).toBeGreaterThan(0);
  });

  it("reports board freshness, not the oldest user's balance age", () => {
    // One user's balance has not refreshed for 14 days. The BOARD is still
    // current: it was derived from live state this instant, and saying
    // "обновлено 14 дней назад" would misdescribe every SLA on screen.
    const staleBalances = users.filter((u) => {
      const ts = u.financial.balanceTimestamp;
      return ts !== null && clock.nowMs() - new Date(ts).getTime() > 24 * 3_600_000;
    });
    expect(staleBalances.length).toBeGreaterThan(0);
    expect(build().freshness.ageMinutes).toBe(0);
  });

  it("exposes a timestamp, never an amount", () => {
    expect(JSON.stringify(build().freshness)).not.toMatch(/\$\s?\d/);
  });
});

describe("Today — recommendations, owner, due", () => {
  it("carries the domain's recommendation, never a no-op filler", () => {
    const withRec = itemsOf().filter((i) => i.recommendation);
    expect(withRec.length).toBeGreaterThan(0);
    for (const item of withRec) {
      expect(item.recommendation!.code).not.toBe("no_action_required");
      // The code, not a title: wording is config/labels' single responsibility.
      expect(RECOMMENDATION_LABEL[item.recommendation!.code]).toBeTruthy();
    }
  });

  it("marks a recommendation the role may not carry out", () => {
    const mentorItems = itemsOf("mentor").filter((i) => i.recommendation);
    // The flag exists and is a real boolean — the UI shows «не для вашей роли».
    expect(mentorItems.some((i) => i.recommendation!.allowedForRole === false)).toBe(true);
  });

  it("distinguishes a contractual SLA from a plain follow-up", () => {
    const items = itemsOf().filter((i) => i.due);
    expect(items.some((i) => i.due!.isSla)).toBe(true);
    for (const item of items) {
      if (item.due!.isSla) expect(item.due!.key).not.toBeNull();
      else expect(item.due!.state).toBe("none");
    }
  });

  it("computes hoursUntil from the provider clock", () => {
    for (const item of itemsOf().filter((i) => i.due)) {
      const expected = Math.round((new Date(item.due!.at).getTime() - clock.nowMs()) / 3_600_000);
      expect(item.due!.hoursUntil).toBe(expected);
    }
  });

  it("keeps owner as the fixtures have it, including unassigned", () => {
    const items = itemsOf();
    expect(items.some((i) => i.ownerId !== null)).toBe(true);
    expect(items.some((i) => i.ownerId === null)).toBe(true);
  });
});

describe("Today — every role", () => {
  it.each(CRM_ROLES)("%s receives a coherent, projected workspace", (role) => {
    const ws = build(role);
    expect(ws.role).toBe(role);
    for (const item of ws.sections.flatMap((s) => s.items)) {
      expect(item.identity.mode).toBeTruthy();
      expect(item.basis.text.length).toBeGreaterThan(0);
      expect(TODAY_SECTION_ORDER).toContain(item.section);
    }
  });

  it.each(CRM_ROLES)("%s: queue membership does not depend on role", (role) => {
    // Permission changes WHAT you see about a user, not WHO needs attention —
    // otherwise two operators would disagree about the day's work.
    expect(itemsOf(role).map((i) => i.userId)).toEqual(itemsOf("crm_admin").map((i) => i.userId));
  });

  it("gives an analyst a pseudonymous queue with no names", () => {
    for (const item of itemsOf("analyst")) {
      expect(item.identity.mode).toBe("pseudonymous");
      expect(item.identity.displayName).toBeNull();
      expect(item.identity.email).toBeNull();
      expect(item.identity.pseudonymId).toMatch(/^anon_/);
    }
  });

  it("gives a content_manager no identity at all", () => {
    for (const item of itemsOf("content_manager")) {
      expect(item.identity.mode).toBe("hidden");
      expect(item.identity.displayName).toBeNull();
      expect(item.identity.email).toBeNull();
    }
  });
});
