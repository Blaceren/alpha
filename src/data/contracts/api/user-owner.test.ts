import { describe, expect, it } from "vitest";
import {
  crmApiOwnerCandidatesPageSchema,
  crmApiOwnerErrorSchema,
  crmApiOwnerIdentitySchema,
  crmApiOwnerResponseSchema,
  isValidExpectedVersion,
  validateOwnerEmployeeId,
} from "./user-owner";

const identity = { employeeId: "emp_1", displayName: "Владелец Альфа" };

describe("owner response schema", () => {
  it("accepts an assigned owner", () => {
    const r = crmApiOwnerResponseSchema.safeParse({ owner: identity, ownerVersion: 4 });
    expect(r.success).toBe(true);
  });

  it("accepts the pristine null owner at version 0", () => {
    const r = crmApiOwnerResponseSchema.safeParse({ owner: null, ownerVersion: 0 });
    expect(r.success).toBe(true);
  });

  it("accepts a previously-mutated unassigned owner at a non-zero version", () => {
    const r = crmApiOwnerResponseSchema.safeParse({ owner: null, ownerVersion: 3 });
    expect(r.success).toBe(true);
  });

  it("rejects a negative version", () => {
    expect(crmApiOwnerResponseSchema.safeParse({ owner: null, ownerVersion: -1 }).success).toBe(false);
  });

  it("rejects a fractional version", () => {
    expect(crmApiOwnerResponseSchema.safeParse({ owner: null, ownerVersion: 1.5 }).success).toBe(false);
  });

  it("rejects a missing ownerVersion", () => {
    expect(crmApiOwnerResponseSchema.safeParse({ owner: null }).success).toBe(false);
  });

  it("rejects a blank employeeId", () => {
    expect(
      crmApiOwnerResponseSchema.safeParse({ owner: { employeeId: "", displayName: "X" }, ownerVersion: 1 }).success,
    ).toBe(false);
  });

  it("rejects a whitespace-only displayName", () => {
    expect(
      crmApiOwnerResponseSchema.safeParse({ owner: { employeeId: "e", displayName: "   " }, ownerVersion: 1 }).success,
    ).toBe(false);
  });

  it.each([
    "email",
    "staffRole",
    "userId",
    "ownerId",
    "status",
    "permissionVersion",
    "createdAt",
    "history",
  ])("rejects a forbidden field %s on the owner identity", (field) => {
    const r = crmApiOwnerIdentitySchema.safeParse({ ...identity, [field]: "x" });
    expect(r.success).toBe(false);
  });

  it("rejects an extra top-level key", () => {
    expect(
      crmApiOwnerResponseSchema.safeParse({ owner: null, ownerVersion: 0, reason: "x" }).success,
    ).toBe(false);
  });
});

describe("candidates page schema", () => {
  it("accepts a page of candidates", () => {
    const r = crmApiOwnerCandidatesPageSchema.safeParse({ items: [identity], nextCursor: "c1" });
    expect(r.success).toBe(true);
  });

  it("accepts an empty page with null cursor", () => {
    expect(crmApiOwnerCandidatesPageSchema.safeParse({ items: [], nextCursor: null }).success).toBe(true);
  });

  it("rejects an empty-string cursor", () => {
    expect(crmApiOwnerCandidatesPageSchema.safeParse({ items: [], nextCursor: "" }).success).toBe(false);
  });

  it("rejects a candidate carrying a StaffRole", () => {
    const r = crmApiOwnerCandidatesPageSchema.safeParse({
      items: [{ ...identity, staffRole: "support" }],
      nextCursor: null,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a total field", () => {
    expect(
      crmApiOwnerCandidatesPageSchema.safeParse({ items: [], nextCursor: null, total: 0 }).success,
    ).toBe(false);
  });
});

describe("error envelope schema", () => {
  it("accepts the conflict code", () => {
    const r = crmApiOwnerErrorSchema.safeParse({ code: "conflict", messageKey: "k", requestId: "r" });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown code", () => {
    expect(crmApiOwnerErrorSchema.safeParse({ code: "teapot", messageKey: "k", requestId: "r" }).success).toBe(false);
  });
});

describe("validateOwnerEmployeeId", () => {
  it("accepts null as a first-class unassign value", () => {
    expect(validateOwnerEmployeeId(null)).toEqual({ ok: true, value: null });
  });

  it("keeps a non-null id exactly, without trimming", () => {
    expect(validateOwnerEmployeeId(" emp_x ")).toEqual({ ok: true, value: " emp_x " });
  });

  it("rejects a blank id", () => {
    expect(validateOwnerEmployeeId("   ")).toEqual({ ok: false, reason: "blank" });
  });

  it("rejects an oversized id", () => {
    expect(validateOwnerEmployeeId("x".repeat(513))).toEqual({ ok: false, reason: "too_long" });
  });

  it("never converts a numeric-looking id to a number", () => {
    const result = validateOwnerEmployeeId("123");
    expect(result).toEqual({ ok: true, value: "123" });
    expect(typeof (result as { value: string }).value).toBe("string");
  });
});

describe("isValidExpectedVersion", () => {
  it.each([0, 1, 42])("accepts %i", (v) => expect(isValidExpectedVersion(v)).toBe(true));
  it.each([-1, 1.5, Number.NaN])("rejects %s", (v) => expect(isValidExpectedVersion(v)).toBe(false));
});
