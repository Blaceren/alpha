import { describe, expect, it } from "vitest";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";
import type { CrmRole } from "@/domain/identity/roles";
import type { User360 } from "./user-360";

const clock = new FixedMockClock();
const provider = new MockCrmDataProvider({ clock, delayMs: 0 });
const ctx = (role: CrmRole): CrmContext => ({ actorId: "emp_test", role, now: clock.nowIso() });

/** Nina Chmiel — support blocked, SLA breached, balance $90, checkpoint L10=$100. */
const HIGH_PRIORITY = "usr_mock_026";
/** Lena Mazur — active funded learner, no signals. */
const CALM = "usr_mock_005";
/** Nadia Novak — registered, Pocket incomplete, no balance at all. */
const ONBOARDING = "usr_mock_001";

async function view(role: CrmRole, userId = HIGH_PRIORITY): Promise<User360> {
  const res = await provider.getUser360(ctx(role), { userId });
  return res.data!;
}

describe("getUser360 — result contract", () => {
  it("returns not_found for an unknown user, with no data", async () => {
    const res = await provider.getUser360(ctx("crm_admin"), { userId: "usr_nope" });
    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("not_found");
    expect(res.error?.retriable).toBe(false);
    expect(res.data).toBeNull();
  });

  it("carries freshness and a deterministic generatedAt", async () => {
    const res = await provider.getUser360(ctx("crm_admin"), { userId: HIGH_PRIORITY });
    expect(res.status).toBe("ok");
    expect(res.freshness).not.toBeNull();
    expect(res.data!.generatedAt).toBe(clock.nowIso());
  });

  it("is deterministic: two reads of the same user are identical", async () => {
    const a = await view("crm_admin");
    const b = await view("crm_admin");
    expect(a).toEqual(b);
  });

  it("marks a user with a stale balance as stale but still returns data", async () => {
    // usr_mock_024 (dormant 30d) has an old balance timestamp.
    const res = await provider.getUser360(ctx("crm_admin"), { userId: "usr_mock_024" });
    expect(["ok", "stale"]).toContain(res.status);
    if (res.status === "stale") {
      expect(res.data).not.toBeNull();
      expect(res.freshness?.isStale).toBe(true);
    }
  });

  it("timestamps come from the provider clock, not the wall clock", async () => {
    const other = new MockCrmDataProvider({
      clock: new FixedMockClock("2026-07-14T09:00:00.000Z"),
      delayMs: 0,
    });
    const res = await other.getUser360(ctx("crm_admin"), { userId: HIGH_PRIORITY });
    expect(res.data!.generatedAt).toBe("2026-07-14T09:00:00.000Z");
  });
});

describe("getUser360 — admin (permitted)", () => {
  it("gets the full email in the detail context", async () => {
    const v = await view("crm_admin");
    expect(v.identity.projection.mode).toBe("full");
    expect(v.identity.projection.email).toBe("nina.chmiel@example.test");
  });

  it("gets the exact balance and the checkpoint grid amount", async () => {
    const v = await view("crm_admin");
    expect(v.financial.balance.mode).toBe("exact");
    expect(v.financial.balance.amountUsd).toBe(90);
    expect(v.learning.nextCheckpointRequiredUsd).toBe(100);
  });

  it("gets signals with their numeric explanations and evidence", async () => {
    const v = await view("crm_admin");
    const checkpoint = v.signals.find((s) => s.code === "checkpoint_approaching")!;
    expect(checkpoint.reason).toContain("10%");
    expect(checkpoint.evidence.length).toBeGreaterThan(0);
  });

  it("gets the recommendation with its rationale and read-only metadata", async () => {
    const v = await view("crm_admin");
    const rec = v.recommendations[0]!;
    expect(rec.code).toBe("support_follow_up");
    expect(rec.priority).toBe("critical");
    expect(rec.reason.length).toBeGreaterThan(0);
    expect(rec.allowedForRole).toBe(true);
  });

  it("links the priority to the signal it was derived from", async () => {
    const v = await view("crm_admin");
    expect(v.attention.reasonCode).toBe("critical_support_issue");
    expect(v.attention.sourceSignalCodes).toContain("support_blocked");
  });
});

describe("getUser360 — support (financials restricted)", () => {
  it("gets a masked identity, never the full email", async () => {
    const v = await view("support");
    expect(v.identity.projection.mode).toBe("masked");
    expect(v.identity.projection.email).toBe("n2***@e***.test");
    expect(JSON.stringify(v)).not.toContain("nina.chmiel@example.test");
  });

  it("gets a bucket, and the exact amount is absent from the whole payload", async () => {
    const v = await view("support");
    expect(v.financial.balance.mode).toBe("bucket");
    expect(v.financial.balance.amountUsd).toBeNull();
    expect(v.financial.balance.label).toBe("$50–99");
    expect(v.financial.netDeposits.amountUsd).toBeNull();
    // Nothing anywhere in the serialized aggregate reveals the exact value.
    expect(JSON.stringify(v)).not.toContain("$90");
    expect(JSON.stringify(v)).not.toContain('"amountUsd":90');
  });

  it("cannot reconstruct the balance from checkpoint delta + published grid", async () => {
    // The grid ($100 at L10) is public, so "10% remaining" would give away $90.
    const v = await view("support");
    expect(v.learning.nextCheckpointRequiredUsd).toBeNull();
    const checkpoint = v.signals.find((s) => s.code === "checkpoint_approaching")!;
    expect(checkpoint.reason).toBeNull();
    expect(checkpoint.evidence).toEqual([]);
    expect(JSON.stringify(v)).not.toContain("10%");
  });

  it("still sees the signal itself — only the balance-derived detail is withheld", async () => {
    const v = await view("support");
    expect(v.signals.map((s) => s.code)).toContain("checkpoint_approaching");
    const blocked = v.signals.find((s) => s.code === "support_blocked")!;
    expect(blocked.reason).toBe("Открыт support-блокер.");
  });

  it("does not receive HIGH-sensitivity deposit events in the timeline", async () => {
    const v = await view("support");
    expect(v.activity.map((e) => e.kind)).not.toContain("first_deposit_confirmed");
    const admin = await view("crm_admin");
    expect(admin.activity.map((e) => e.kind)).toContain("first_deposit_confirmed");
  });

  it("is told when a recommendation is addressed to another role", async () => {
    const v = await view("support");
    const rec = v.recommendations.find((r) => r.code === "review_checkpoint_grace")!;
    expect(rec.allowedForRole).toBe(false);
    const own = v.recommendations.find((r) => r.code === "support_follow_up")!;
    expect(own.allowedForRole).toBe(true);
  });
});

describe("getUser360 — other roles", () => {
  it("retention_manager is permitted like an admin (exact + full email)", async () => {
    const v = await view("retention_manager");
    expect(v.identity.projection.mode).toBe("full");
    expect(v.financial.balance.mode).toBe("exact");
    expect(v.learning.nextCheckpointRequiredUsd).toBe(100);
  });

  it("mentor gets learning context, masked identity and bucket financials", async () => {
    const v = await view("mentor");
    expect(v.identity.projection.mode).toBe("masked");
    expect(v.financial.balance.mode).toBe("bucket");
    expect(v.learning.currentLevel).toBe(9);
    expect(JSON.stringify(v)).not.toContain("nina.chmiel@example.test");
    expect(JSON.stringify(v)).not.toContain('"amountUsd":90');
  });

  it("analyst gets a pseudonymous identity with no name, email or context", async () => {
    const v = await view("analyst");
    expect(v.identity.projection.mode).toBe("pseudonymous");
    expect(v.identity.projection.displayName).toBeNull();
    expect(v.identity.projection.email).toBeNull();
    expect(v.identity.projection.pseudonymId).toBe("anon_026");
    // Locale/campaign would re-narrow an anonymized subject.
    expect(v.identity.country).toBeNull();
    expect(v.identity.campaign).toBeNull();
    expect(v.financial.balance.mode).toBe("aggregated");
    expect(JSON.stringify(v)).not.toContain("Nina Chmiel");
  });

  it("content_manager gets no identity at all (D-11)", async () => {
    const v = await view("content_manager");
    expect(v.identity.projection.mode).toBe("hidden");
    expect(v.identity.projection.displayName).toBeNull();
    expect(JSON.stringify(v)).not.toContain("Nina Chmiel");
  });

  it("read_only gets hidden financials, marked as a permission restriction", async () => {
    const v = await view("read_only");
    expect(v.financial.balance.mode).toBe("hidden");
    expect(v.financial.balance.hiddenReason).toBe("not_permitted");
    expect(JSON.stringify(v)).not.toContain('"amountUsd":90');
  });
});

describe("getUser360 — honest absence vs restriction", () => {
  it("distinguishes 'no data' from 'not permitted' for a user with no balance", async () => {
    const v = await view("crm_admin", ONBOARDING);
    expect(v.financial.balance.mode).toBe("hidden");
    // The admin MAY see financials — the value simply does not exist.
    expect(v.financial.balance.hiddenReason).toBe("no_data");
    expect(v.financial.balance.label).toBe("Нет данных");
  });

  it("keeps Pocket registration independent of funding and email confirmation", async () => {
    const v = await view("crm_admin", ONBOARDING);
    expect(v.states.registrationStatus).toBe("not_registered");
    expect(v.states.fundingStatus).toBe("not_available");
    expect(v.states.blockers).toContain("pocket_registration_incomplete");
  });
});

describe("getUser360 — calm user", () => {
  it("reports no signals and a no-action recommendation", async () => {
    const v = await view("crm_admin", CALM);
    expect(v.attention.priority).toBe("low");
    expect(v.attention.reasonCode).toBe("no_priority_signal");
    expect(v.attention.sourceSignalCodes).toEqual([]);
    expect(v.signals).toEqual([]);
    expect(v.states.blockers).toEqual([]);
    expect(v.recommendations).toHaveLength(1);
    expect(v.recommendations[0]!.code).toBe("no_action_required");
  });

  it("does not emit the same event twice at one timestamp", async () => {
    const v = await view("crm_admin", CALM);
    const ids = v.activity.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Learning activity and the meaningful action coincide → a single row.
    const sameMoment = v.activity.filter((e) => e.at === "2026-07-13T07:00:00.000Z");
    expect(sameMoment).toHaveLength(1);
  });
});
