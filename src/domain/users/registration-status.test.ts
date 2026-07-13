import { describe, expect, it } from "vitest";
import { FixedMockClock } from "@/lib/clock";
import { buildDataset } from "@/data/mock/fixtures/build";
import { computeSignals } from "@/domain/signals/engine";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";
import type { MockUser } from "@/domain/users/mock-user";

const clock = new FixedMockClock();
const users = buildDataset(clock);
const byId = (id: string) => users.find((u) => u.identity.userId === id)!;
const ctx: CrmContext = { actorId: "emp_mock_admin", role: "crm_admin", now: clock.nowIso() };

const ALLOWED = ["not_registered", "registration_pending", "registered"] as const;

describe("registrationStatus — finalized 3-value model", () => {
  it("only ever uses the three allowed values (no confirmed / deregistered)", () => {
    const used = new Set(users.map((u) => u.financial.registrationStatus));
    for (const v of used) expect(ALLOWED).toContain(v);
    expect(used.has("confirmed" as never)).toBe(false);
    expect(used.has("deregistered" as never)).toBe(false);
  });

  it("default persona uses `registered` (backend-confirmed affiliate registration)", () => {
    // usr_mock_005 is a plain funded learner using the mk() default.
    expect(byId("usr_mock_005").financial.registrationStatus).toBe("registered");
  });

  it("persona 003 proves Pocket registration and ATA email are independent axes", () => {
    const u = byId("usr_mock_003");
    expect(u.financial.registrationStatus).toBe("registered");
    expect(u.identity.emailConfirmed).toBe(false);
    expect(u.state.blockers).toContain("email_unconfirmed");
    expect(computeSignals(u, clock).map((s) => s.code)).toContain("email_not_confirmed");
  });
});

describe("pocket_registration_incomplete signal vs registrationStatus", () => {
  const base = byId("usr_mock_002");
  const withStatus = (status: MockUser["financial"]["registrationStatus"], hoursAgoReg: number): MockUser => ({
    ...base,
    identity: { ...base.identity, registeredAt: new Date(clock.nowMs() - hoursAgoReg * 3600_000).toISOString() },
    financial: { ...base.financial, registrationStatus: status },
  });
  const codes = (u: MockUser) => computeSignals(u, clock).map((s) => s.code);

  it("fires for not_registered past threshold", () => {
    expect(codes(withStatus("not_registered", 48))).toContain("pocket_registration_incomplete");
  });
  it("fires for registration_pending past threshold", () => {
    expect(codes(withStatus("registration_pending", 48))).toContain("pocket_registration_incomplete");
  });
  it("does NOT fire for registered", () => {
    expect(codes(withStatus("registered", 48))).not.toContain("pocket_registration_incomplete");
  });
});

describe("email_not_confirmed depends only on identity.emailConfirmed", () => {
  const base = byId("usr_mock_005"); // registered + emailConfirmed true by default
  const codes = (u: MockUser) => computeSignals(u, clock).map((s) => s.code);

  it("absent when email is confirmed (regardless of registration)", () => {
    expect(codes(base)).not.toContain("email_not_confirmed");
  });
  it("present when email is unconfirmed, even if Pocket registration = registered", () => {
    const u: MockUser = {
      ...base,
      identity: {
        ...base.identity,
        emailConfirmed: false,
        registeredAt: new Date(clock.nowMs() - 24 * 3600_000).toISOString(),
      },
    };
    expect(u.financial.registrationStatus).toBe("registered");
    expect(codes(u)).toContain("email_not_confirmed");
  });
});

describe("registrationStatus filter", () => {
  it("accepts `registered` and returns matching users", async () => {
    const provider = new MockCrmDataProvider({ clock });
    const res = await provider.searchUsers(ctx, {
      filters: { registrationStatus: ["registered"] },
      page: { pageSize: 100 },
    });
    expect(res.data!.items.length).toBeGreaterThan(0);
    expect(res.data!.items.every((u) => u.registrationStatus === "registered")).toBe(true);
  });

  it("rejects the removed values (confirmed / deregistered) — no matches", async () => {
    const provider = new MockCrmDataProvider({ clock });
    // These are not valid values of the type; passed via `as never` to prove no
    // user carries them, so filtering yields nothing.
    const res = await provider.searchUsers(ctx, {
      filters: { registrationStatus: ["confirmed", "deregistered"] as never },
      page: { pageSize: 100 },
    });
    expect(res.data?.items.length ?? 0).toBe(0);
  });
});
