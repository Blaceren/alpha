import { describe, expect, it } from "vitest";
import {
  crmApiUserDetailErrorSchema,
  crmApiUserDetailSchema,
} from "./user-detail";
import { isValidCrmUserId, PRISMA_INT_MAX } from "./user-id";

const VALID = {
  userId: "1042",
  displayName: "Target Learner",
  email: { value: "l***@e***.test", visibility: "masked" },
  status: "active",
  level: 7,
  xp: 4242,
  emailConfirmed: true,
  createdAt: "2026-01-01T12:00:00.000Z",
} as const;

const withField = (patch: Record<string, unknown>) =>
  crmApiUserDetailSchema.safeParse({ ...VALID, ...patch });

describe("crmApiUserDetailSchema — accepts the contract", () => {
  it("accepts a valid DTO", () => {
    expect(crmApiUserDetailSchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts both statuses", () => {
    expect(withField({ status: "active" }).success).toBe(true);
    expect(withField({ status: "blocked" }).success).toBe(true);
  });

  it("accepts both email visibilities", () => {
    expect(withField({ email: { value: "a@b.test", visibility: "full" } }).success).toBe(true);
    expect(withField({ email: { value: "a***@b***.test", visibility: "masked" } }).success).toBe(true);
  });

  it("accepts zero and positive xp", () => {
    expect(withField({ xp: 0 }).success).toBe(true);
    expect(withField({ xp: 1_000_000 }).success).toBe(true);
  });

  it("accepts an offset ISO datetime", () => {
    expect(withField({ createdAt: "2026-01-01T12:00:00+02:00" }).success).toBe(true);
  });

  it("keeps userId a string and never coerces it", () => {
    const parsed = crmApiUserDetailSchema.parse({ ...VALID, userId: "0071" });
    expect(parsed.userId).toBe("0071");
    expect(typeof parsed.userId).toBe("string");
  });
});

describe("crmApiUserDetailSchema — rejects malformed values", () => {
  it("rejects a negative xp", () => {
    expect(withField({ xp: -1 }).success).toBe(false);
  });

  it("rejects a fractional xp", () => {
    expect(withField({ xp: 1.5 }).success).toBe(false);
  });

  it("rejects a stringly-typed xp", () => {
    expect(withField({ xp: "4242" }).success).toBe(false);
  });

  it("rejects a fractional level", () => {
    expect(withField({ level: 1.5 }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(withField({ status: "suspended" }).success).toBe(false);
  });

  it("rejects an unknown visibility", () => {
    expect(withField({ email: { value: "x", visibility: "partial" } }).success).toBe(false);
  });

  it("rejects an empty userId and a numeric userId", () => {
    expect(withField({ userId: "" }).success).toBe(false);
    expect(withField({ userId: 1042 }).success).toBe(false);
  });

  it("rejects a blank displayName and an empty email value", () => {
    expect(withField({ displayName: "   " }).success).toBe(false);
    expect(withField({ email: { value: "", visibility: "masked" } }).success).toBe(false);
  });

  it("rejects an invalid datetime", () => {
    for (const createdAt of ["not-a-date", "2026-13-01T00:00:00Z", "", "1784538632551"]) {
      expect(withField({ createdAt }).success).toBe(false);
    }
  });

  it("rejects every missing required field", () => {
    for (const key of Object.keys(VALID)) {
      const partial: Record<string, unknown> = { ...VALID };
      delete partial[key];
      expect(crmApiUserDetailSchema.safeParse(partial).success).toBe(false);
    }
  });
});

describe("crmApiUserDetailSchema — closed to fields the backend does not send", () => {
  it.each([
    ["employeeId", { employeeId: "emp_stub_admin" }],
    ["role", { role: "crm_admin" }],
    ["staffRole", { staffRole: "support" }],
    ["permissions", { permissions: ["view_audit"] }],
    ["effectivePermissions", { effectivePermissions: [] }],
    ["ownerId", { ownerId: "emp_1" }],
    ["noteCount", { noteCount: 3 }],
    ["balance", { balance: 90 }],
    ["netDeposits", { netDeposits: 100 }],
    ["lastMeaningfulActionAt", { lastMeaningfulActionAt: "2026-01-01T00:00:00.000Z" }],
    ["lifecycleStage", { lifecycleStage: "active" }],
    ["fundingStatus", { fundingStatus: "funded" }],
    ["engagementStatus", { engagementStatus: "active" }],
    ["updatedAt", { updatedAt: "2026-01-01T00:00:00.000Z" }],
    ["currentTask", { currentTask: "Шаг 3" }],
    ["achievements", { achievements: [] }],
    ["passwordHash", { passwordHash: "x" }],
    ["timeline", { timeline: [] }],
    ["recommendations", { recommendations: [] }],
  ])("rejects an extra %s field", (_label, patch) => {
    expect(withField(patch as Record<string, unknown>).success).toBe(false);
  });

  it("rejects a non-object body", () => {
    for (const body of [null, undefined, "string", 42, []]) {
      expect(crmApiUserDetailSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("crmApiUserDetailErrorSchema", () => {
  it("accepts the four canonical codes", () => {
    for (const code of ["invalid_input", "unauthorized", "not_found", "internal"]) {
      expect(
        crmApiUserDetailErrorSchema.safeParse({ code, messageKey: "k", requestId: "r" }).success,
      ).toBe(true);
    }
  });

  it("rejects an unknown code and extra fields", () => {
    expect(crmApiUserDetailErrorSchema.safeParse({ code: "teapot", messageKey: "k", requestId: "r" }).success).toBe(false);
    expect(
      crmApiUserDetailErrorSchema.safeParse({ code: "internal", messageKey: "k", requestId: "r", stack: "x" }).success,
    ).toBe(false);
  });
});

describe("isValidCrmUserId", () => {
  it("accepts canonical positive decimals", () => {
    for (const id of ["1", "9", "42", "1042", "999999999", String(PRISMA_INT_MAX)]) {
      expect(isValidCrmUserId(id), id).toBe(true);
    }
  });

  it("rejects zero, negatives and signs", () => {
    for (const id of ["0", "-1", "+1", "-0"]) {
      expect(isValidCrmUserId(id), id).toBe(false);
    }
  });

  it("rejects leading zeros", () => {
    for (const id of ["01", "007", "0071", "00"]) {
      expect(isValidCrmUserId(id), id).toBe(false);
    }
  });

  it("rejects decimals, exponents and non-decimal notations", () => {
    for (const id of ["1.5", "1e3", "1E3", "0x10", "1n", "1,2", "1_000"]) {
      expect(isValidCrmUserId(id), id).toBe(false);
    }
  });

  it("rejects whitespace in any position", () => {
    for (const id of ["", " ", "1 ", " 1", "1 2", "\t1", "1\n"]) {
      expect(isValidCrmUserId(id), id).toBe(false);
    }
  });

  it("rejects mock and employeeId-shaped values", () => {
    for (const id of ["mock_user_1", "usr_mock_017", "emp_backend_001", "emp_stub_7f3a9c", "abc", "12abc"]) {
      expect(isValidCrmUserId(id), id).toBe(false);
    }
  });

  it("rejects values above the Prisma Int range", () => {
    expect(isValidCrmUserId(String(PRISMA_INT_MAX))).toBe(true);
    expect(isValidCrmUserId(String(PRISMA_INT_MAX + 1))).toBe(false);
    expect(isValidCrmUserId("9999999999")).toBe(false);
    expect(isValidCrmUserId("99999999999999999999")).toBe(false);
  });

  it("does not accept a numeric prefix the way parseInt would", () => {
    // parseInt("12abc") === 12; this validator must reject it outright.
    expect(isValidCrmUserId("12abc")).toBe(false);
    expect(isValidCrmUserId("1.9")).toBe(false);
  });
});
