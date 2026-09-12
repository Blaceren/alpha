/**
 * Today privacy invariants (Phase 1B3 §23/§24, preserving Phase 1C.1).
 *
 * The rule under test: a value a role may not see is never BUILT, so it cannot
 * reach the client through the result, the DOM, or an aria/title attribute. The
 * assertions therefore run against the serialized workspace — what would be sent
 * — rather than against rendered markup.
 */
import { describe, expect, it } from "vitest";
import { FixedMockClock } from "@/lib/clock";
import { buildDataset } from "@/data/mock/fixtures/build";
import { CRM_ROLES, type CrmRole } from "@/domain/identity/roles";
import { canViewExactFinancials } from "@/domain/identity/access";
import { FINANCIALLY_DERIVED_SIGNALS } from "@/domain/financial/financially-derived";
import { buildTodayWorkspace } from "./builder";
import type { TodayQuery } from "./today-query";

const clock = new FixedMockClock();
const users = buildDataset(clock);

const build = (role: CrmRole, query?: TodayQuery) => buildTodayWorkspace({ users, clock, role, query });
const itemsOf = (role: CrmRole) => build(role).sections.flatMap((s) => s.items);

const EXACT_ROLES: CrmRole[] = ["crm_admin", "crm_manager", "retention_manager"];
const NON_EXACT_ROLES = CRM_ROLES.filter((r) => !EXACT_ROLES.includes(r));

describe("Today — financial privacy", () => {
  it.each(NON_EXACT_ROLES)("%s never receives an exact amount in the result", (role) => {
    for (const item of itemsOf(role)) {
      // Null = a balance is not part of this row at all.
      if (!item.financial) continue;
      expect(item.financial.mode).not.toBe("exact");
      expect(item.financial.amountUsd).toBeNull();
    }
  });

  it.each(NON_EXACT_ROLES)("%s: no exact amount appears anywhere in the serialized workspace", (role) => {
    const serialized = JSON.stringify(build(role));
    expect(serialized).not.toMatch(/"amountUsd":\s*\d/);
    // A dollar figure must not survive in any string field either (label,
    // basis text, recommendation title, evidence).
    expect(serialized).not.toMatch(/\$\s?\d+(?!\d*[–—-])/);
  });

  it.each(EXACT_ROLES)("%s does receive exact amounts (the test can actually fail)", (role) => {
    const exact = itemsOf(role).filter((i) => i.financial?.mode === "exact");
    expect(exact.length).toBeGreaterThan(0);
    expect(exact.some((i) => typeof i.financial!.amountUsd === "number")).toBe(true);
  });

  it.each(NON_EXACT_ROLES)("%s cannot reconstruct a balance from a checkpoint percentage", (role) => {
    // The checkpoint grid is published ($100 at L10), so "осталось 5%" plus the
    // grid yields $95 exactly. The reason text must be neutral for these roles.
    for (const item of itemsOf(role)) {
      if (item.basis.signalCode && FINANCIALLY_DERIVED_SIGNALS.includes(item.basis.signalCode)) {
        expect(item.basis.text).not.toMatch(/\d+\s?%/);
        expect(item.evidence).toEqual([]);
      }
    }
  });

  it.each(NON_EXACT_ROLES)("%s: no balance-derived evidence survives projection", (role) => {
    // The leak to prevent is a number DERIVED from a balance, not a number that
    // happens to equal one: "Возраст данных баланса · 500 мин" is not $500, and
    // comparing raw magnitudes across units would only test a coincidence.
    // `checkpoint_delta_pct` and `balance_drop_pct` are the derived ones.
    const BALANCE_DERIVED_EVIDENCE = ["checkpoint_delta_pct", "balance_drop_pct"];
    for (const item of itemsOf(role)) {
      for (const e of item.evidence) {
        expect(e.sensitivity).not.toBe("HIGH");
        expect(e.sensitivity).not.toBe("RESTRICTED");
        expect(BALANCE_DERIVED_EVIDENCE).not.toContain(e.code);
      }
    }
  });

  it("a permitted role DOES get the balance-derived explanation (the rule is real)", () => {
    const withPct = itemsOf("crm_admin").filter((i) => /\d+\s?%/.test(i.basis.text));
    expect(withPct.length).toBeGreaterThan(0);
    // …and the same users read neutrally for support.
    const ids = withPct.map((i) => i.userId);
    for (const item of itemsOf("support").filter((i) => ids.includes(i.userId))) {
      expect(item.basis.text).not.toMatch(/\d+\s?%/);
    }
  });

  it("shows a balance only where it aids triage, even for a permitted role", () => {
    const items = itemsOf("crm_admin");
    const shown = items.filter((i) => i.financial?.mode === "exact");
    const notRelevant = items.filter((i) => i.financial === null);
    expect(shown.length).toBeGreaterThan(0);
    expect(notRelevant.length).toBeGreaterThan(0);
    // An admin chasing a report gets no balance: the column existing is not a
    // reason to print the number (§10).
    for (const item of shown) {
      expect(["checkpoint_attention", "data_quality_issues"]).toContain(item.basis.code);
    }
  });

  it("keeps onboarding items free of financial values (D-24 preserved)", () => {
    for (const role of CRM_ROLES) {
      const onboarding = itemsOf(role).filter((i) => i.basis.code === "onboarding_attention");
      expect(onboarding.length).toBeGreaterThan(0);
      for (const item of onboarding) {
        // No balance is carried at all — the strongest form of "not shown".
        expect(item.financial).toBeNull();
      }
    }
  });

  it("the summary reveals nothing financial about a hidden user", () => {
    for (const role of NON_EXACT_ROLES) {
      const s = build(role).summary;
      // Counts are about work, not money — and match the permitted role's own
      // queue exactly, so they cannot be differenced against an admin's board.
      expect(s).toEqual(build("crm_admin").summary);
      expect(JSON.stringify(s)).not.toMatch(/\$|amount|balance|deposit/i);
    }
  });

  it.each(NON_EXACT_ROLES)("%s: no HIGH timeline event leaks through todayEvent", (role) => {
    for (const item of itemsOf(role)) {
      if (item.todayEvent) {
        expect(item.todayEvent.title).not.toMatch(/депозит/i);
      }
    }
  });
});

describe("Today — identity privacy", () => {
  it("never emits a full email — a queue is a list", () => {
    for (const role of CRM_ROLES) {
      const serialized = JSON.stringify(build(role));
      for (const u of users) {
        expect(serialized).not.toContain(u.identity.fullEmail);
      }
    }
  });

  it("gives an analyst pseudonyms only, with no name or email anywhere", () => {
    const serialized = JSON.stringify(build("analyst"));
    for (const u of users) {
      expect(serialized).not.toContain(u.identity.displayName);
      expect(serialized).not.toContain(u.identity.maskedEmail);
    }
  });

  it("gives a content_manager no identity fields at all", () => {
    const serialized = JSON.stringify(build("content_manager"));
    for (const u of users) {
      expect(serialized).not.toContain(u.identity.displayName);
      expect(serialized).not.toContain(u.identity.maskedEmail);
    }
  });

  it("search matches only identity the role is allowed to see", () => {
    const target = users.find((u) => u.identity.displayName === "Nina Chmiel")!;

    // A role that sees names can find the user by name.
    const admin = build("crm_admin", { filters: { query: "Nina" } });
    expect(admin.summary.totalAttention).toBe(1);

    // An analyst gets pseudonyms, so the same name matches nothing — the name is
    // not in a client-side index for it to match against.
    const analyst = build("analyst", { filters: { query: "Nina" } });
    expect(analyst.summary.totalAttention).toBe(0);

    // Searching a full email finds nobody, for anyone.
    for (const role of CRM_ROLES) {
      expect(build(role, { filters: { query: target.identity.fullEmail } }).summary.totalAttention).toBe(0);
    }
  });

  it("lets a pseudonymous role search by the identifier it was actually given", () => {
    const analyst = build("analyst");
    const first = analyst.sections[0]!.items[0]!;
    const found = build("analyst", { filters: { query: first.identity.pseudonymId! } });
    expect(found.summary.totalAttention).toBe(1);
  });

  it("keeps the user id available for the profile link without exposing identity", () => {
    for (const item of itemsOf("content_manager")) {
      expect(item.userId).toMatch(/^usr_mock_/);
      expect(item.identity.displayName).toBeNull();
    }
  });
});

describe("Today — role projection is applied by the builder, not the UI", () => {
  it.each(CRM_ROLES)("%s: financial mode matches the role's permission exactly", (role) => {
    const exact = canViewExactFinancials(role);
    for (const item of itemsOf(role)) {
      if (item.financial?.mode === "exact") expect(exact).toBe(true);
    }
  });

  it("switching role rebuilds the projection with no forbidden leftovers", () => {
    const asAdmin = build("crm_admin");
    const asSupport = build("support");
    expect(JSON.stringify(asSupport)).not.toEqual(JSON.stringify(asAdmin));
    // Same work, different visibility.
    expect(asSupport.summary.totalAttention).toBe(asAdmin.summary.totalAttention);
  });
});
