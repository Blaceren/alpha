import { describe, expect, it } from "vitest";
import {
  crmApiErrorSchema,
  crmApiUserOwnerSchema,
  crmApiUserSchema,
  crmApiUsersResponseSchema,
} from "./users";

const VALID_USER = {
  userId: "1042",
  displayName: "Пользователь 01",
  email: { value: "l***@e***.test", visibility: "masked" },
  status: "active",
  level: 7,
  emailConfirmed: true,
  createdAt: "2026-01-04T09:15:00.000Z",
  owner: { displayName: "Мария Куратор" },
} as const;

const withUser = (patch: Record<string, unknown>) =>
  crmApiUserSchema.safeParse({ ...VALID_USER, ...patch });

describe("crmApiUserSchema — accepts the contract", () => {
  it("accepts a valid item", () => {
    expect(crmApiUserSchema.safeParse(VALID_USER).success).toBe(true);
  });

  it("accepts both visibilities", () => {
    expect(withUser({ email: { value: "a@b.test", visibility: "full" } }).success).toBe(true);
    expect(withUser({ email: { value: "a***@b***.test", visibility: "masked" } }).success).toBe(true);
  });

  it("accepts both statuses", () => {
    expect(withUser({ status: "active" }).success).toBe(true);
    expect(withUser({ status: "blocked" }).success).toBe(true);
  });

  it("accepts an offset ISO datetime", () => {
    expect(withUser({ createdAt: "2026-01-04T09:15:00+02:00" }).success).toBe(true);
  });

  it("keeps userId a string and never coerces it to a number", () => {
    const parsed = crmApiUserSchema.parse({ ...VALID_USER, userId: "007" });
    expect(parsed.userId).toBe("007");
    expect(typeof parsed.userId).toBe("string");
  });
});

describe("crmApiUserSchema — rejects malformed values", () => {
  it("rejects an unknown status", () => {
    expect(withUser({ status: "suspended" }).success).toBe(false);
  });

  it("rejects an unknown visibility", () => {
    expect(withUser({ email: { value: "x", visibility: "partial" } }).success).toBe(false);
  });

  it("rejects an empty userId", () => {
    expect(withUser({ userId: "" }).success).toBe(false);
  });

  it("rejects a numeric userId", () => {
    expect(withUser({ userId: 1042 }).success).toBe(false);
  });

  it("rejects a blank displayName", () => {
    expect(withUser({ displayName: "   " }).success).toBe(false);
  });

  it("rejects an empty email value", () => {
    expect(withUser({ email: { value: "", visibility: "masked" } }).success).toBe(false);
  });

  it("rejects a non-integer level", () => {
    expect(withUser({ level: 1.5 }).success).toBe(false);
    expect(withUser({ level: "7" }).success).toBe(false);
  });

  it("rejects a non-boolean emailConfirmed", () => {
    expect(withUser({ emailConfirmed: "true" }).success).toBe(false);
  });

  it("rejects an invalid datetime", () => {
    for (const createdAt of ["not-a-date", "2026-13-01T00:00:00Z", "", "1784538632551"]) {
      expect(withUser({ createdAt }).success).toBe(false);
    }
  });

  it("rejects every missing required field", () => {
    for (const key of Object.keys(VALID_USER)) {
      const partial: Record<string, unknown> = { ...VALID_USER };
      delete partial[key];
      expect(crmApiUserSchema.safeParse(partial).success).toBe(false);
    }
  });
});

describe("crmApiUserSchema — closed to fields the backend does not send", () => {
  // .strict() turns contract drift, a proxy swap or a fabricated field into a
  // loud failure rather than a silently rendered lie.
  it.each([
    ["employeeId", { employeeId: "emp_stub_admin" }],
    ["ownerId", { ownerId: "emp_1" }],
    ["owner with an unknown key", { owner: { id: "emp_1" } }],
    ["noteCount", { noteCount: 3 }],
    ["unreadCount", { unreadCount: 1 }],
    ["balance", { balance: 90 }],
    ["netDeposits", { netDeposits: 100 }],
    ["financial bucket", { bucket: "$50–99" }],
    ["lastMeaningfulActionAt", { lastMeaningfulActionAt: "2026-01-01T00:00:00.000Z" }],
    ["lifecycleStage", { lifecycleStage: "active" }],
    ["fundingStatus", { fundingStatus: "funded" }],
    ["engagementStatus", { engagementStatus: "active" }],
    ["priority", { priority: "high" }],
    ["raw passwordHash", { passwordHash: "x" }],
    ["raw updatedAt", { updatedAt: "2026-01-01T00:00:00.000Z" }],
    ["raw xp", { xp: 42 }],
  ])("rejects an extra %s field", (_label, patch) => {
    expect(withUser(patch as Record<string, unknown>).success).toBe(false);
  });
});

describe("owner projection — displayName only, or null", () => {
  it("accepts an assigned owner", () => {
    expect(withUser({ owner: { displayName: "Мария Куратор" } }).success).toBe(true);
  });

  it("accepts a null owner (pristine or persisted-unassigned)", () => {
    expect(withUser({ owner: null }).success).toBe(true);
  });

  it("requires the owner key (backend always sends it)", () => {
    const partial: Record<string, unknown> = { ...VALID_USER };
    delete partial.owner;
    expect(crmApiUserSchema.safeParse(partial).success).toBe(false);
  });

  it("rejects a blank owner displayName", () => {
    expect(withUser({ owner: { displayName: "   " } }).success).toBe(false);
    expect(withUser({ owner: { displayName: "" } }).success).toBe(false);
  });

  it.each([
    ["employeeId", { displayName: "Мария", employeeId: "emp_1" }],
    ["ownerId", { displayName: "Мария", ownerId: "emp_1" }],
    ["ownerVersion", { displayName: "Мария", ownerVersion: 3 }],
    ["StaffRole", { displayName: "Мария", staffRole: "support" }],
    ["role", { displayName: "Мария", role: "support" }],
    ["email", { displayName: "Мария", email: "m@e.test" }],
    ["status", { displayName: "Мария", status: "active" }],
    ["permissionVersion", { displayName: "Мария", permissionVersion: 1 }],
    ["createdAt", { displayName: "Мария", createdAt: "2026-01-01T00:00:00.000Z" }],
    ["updatedAt", { displayName: "Мария", updatedAt: "2026-01-01T00:00:00.000Z" }],
  ])("rejects an owner carrying a forbidden %s field", (_label, owner) => {
    expect(withUser({ owner }).success).toBe(false);
    // The standalone owner schema fails closed on the same field.
    expect(crmApiUserOwnerSchema.safeParse(owner).success).toBe(false);
  });

  it("rejects a non-object owner", () => {
    for (const owner of ["Мария", 1, true, []]) {
      expect(withUser({ owner }).success).toBe(false);
    }
  });
});

describe("crmApiUsersResponseSchema", () => {
  it("accepts a populated page with a cursor", () => {
    const parsed = crmApiUsersResponseSchema.safeParse({
      items: [VALID_USER, { ...VALID_USER, userId: "1043" }],
      nextCursor: "abc",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an empty page", () => {
    expect(crmApiUsersResponseSchema.safeParse({ items: [], nextCursor: null }).success).toBe(true);
  });

  it("rejects duplicate userId values in one response", () => {
    // A duplicate means pagination is not stable; render nothing rather than
    // a list with colliding React keys.
    const parsed = crmApiUsersResponseSchema.safeParse({
      items: [VALID_USER, { ...VALID_USER }],
      nextCursor: null,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty-string nextCursor", () => {
    expect(crmApiUsersResponseSchema.safeParse({ items: [], nextCursor: "" }).success).toBe(false);
  });

  it("rejects a missing nextCursor", () => {
    expect(crmApiUsersResponseSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it("rejects an extra envelope key", () => {
    for (const patch of [{ total: 12 }, { page: 1 }, { hasMore: true }]) {
      expect(
        crmApiUsersResponseSchema.safeParse({ items: [], nextCursor: null, ...patch }).success,
      ).toBe(false);
    }
  });

  it("rejects a non-object body", () => {
    for (const body of [null, undefined, "string", 42, []]) {
      expect(crmApiUsersResponseSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("crmApiErrorSchema", () => {
  it("accepts the three canonical codes", () => {
    for (const code of ["invalid_input", "unauthorized", "internal"]) {
      expect(
        crmApiErrorSchema.safeParse({ code, messageKey: "k", requestId: "r" }).success,
      ).toBe(true);
    }
  });

  it("rejects an unknown code and extra fields", () => {
    expect(crmApiErrorSchema.safeParse({ code: "teapot", messageKey: "k", requestId: "r" }).success).toBe(false);
    expect(
      crmApiErrorSchema.safeParse({ code: "internal", messageKey: "k", requestId: "r", stack: "x" }).success,
    ).toBe(false);
  });
});
