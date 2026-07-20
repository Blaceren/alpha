import { describe, expect, it } from "vitest";
import { CRM_ROLES } from "@/domain/identity/roles";
import { SESSION_PERMISSIONS, SessionDtoSchema } from "./session-dto";

const VALID = {
  employeeId: "emp_7f3a9c",
  displayName: "Ирина Соколова",
  role: "support",
  effectivePermissions: ["edit_user_notes"],
  permissionVersion: 3,
  expiresAt: "2026-07-20T18:30:00.000Z",
} as const;

function withField(patch: Record<string, unknown>) {
  return SessionDtoSchema.safeParse({ ...VALID, ...patch });
}

describe("SessionDtoSchema — accepts the contract", () => {
  it("accepts the exact valid DTO", () => {
    const parsed = SessionDtoSchema.safeParse(VALID);
    expect(parsed.success).toBe(true);
  });

  it("accepts an empty permission list", () => {
    // A role with no effective permissions is legitimate and must parse — it is
    // the case the UI authority test depends on.
    expect(withField({ effectivePermissions: [] }).success).toBe(true);
  });

  it("accepts all eight canonical permissions at once", () => {
    expect(withField({ effectivePermissions: [...SESSION_PERMISSIONS] }).success).toBe(true);
  });

  it.each(CRM_ROLES)("accepts the canonical role %s", (role) => {
    expect(withField({ role }).success).toBe(true);
  });

  it("accepts an opaque employeeId of any shape", () => {
    // Deliberately not cuid/uuid/hex constrained.
    for (const employeeId of ["e", "emp_7f3a9c", "01HZY8", "a-b-c-d", "нестандартный-id"]) {
      expect(withField({ employeeId }).success).toBe(true);
    }
  });

  it("accepts an offset ISO datetime", () => {
    expect(withField({ expiresAt: "2026-07-20T18:30:00+02:00" }).success).toBe(true);
  });
});

describe("SessionDtoSchema — rejects unknown vocabulary", () => {
  it("rejects an unknown role", () => {
    expect(withField({ role: "superadmin" }).success).toBe(false);
  });

  it("rejects an Academy UserRole leaking in", () => {
    expect(withField({ role: "student" }).success).toBe(false);
  });

  it("rejects an unknown permission", () => {
    expect(withField({ effectivePermissions: ["delete_everything"] }).success).toBe(false);
  });

  it("rejects a duplicate permission", () => {
    expect(
      withField({ effectivePermissions: ["edit_user_notes", "edit_user_notes"] }).success,
    ).toBe(false);
  });

  it("rejects permissions that are not an array", () => {
    expect(withField({ effectivePermissions: "edit_user_notes" }).success).toBe(false);
  });
});

describe("SessionDtoSchema — rejects malformed scalars", () => {
  it("rejects an empty employeeId", () => {
    expect(withField({ employeeId: "" }).success).toBe(false);
  });

  it("rejects a blank displayName", () => {
    expect(withField({ displayName: "   " }).success).toBe(false);
  });

  it("rejects permissionVersion 0", () => {
    expect(withField({ permissionVersion: 0 }).success).toBe(false);
  });

  it("rejects a negative permissionVersion", () => {
    expect(withField({ permissionVersion: -1 }).success).toBe(false);
  });

  it("rejects a fractional permissionVersion", () => {
    expect(withField({ permissionVersion: 1.5 }).success).toBe(false);
  });

  it("rejects a stringly-typed permissionVersion", () => {
    expect(withField({ permissionVersion: "3" }).success).toBe(false);
  });

  it("rejects an invalid expiresAt", () => {
    for (const expiresAt of ["not-a-date", "2026-13-01T00:00:00Z", "", "1784538632551"]) {
      expect(withField({ expiresAt }).success).toBe(false);
    }
  });

  it("rejects missing required fields", () => {
    for (const key of Object.keys(VALID)) {
      const partial: Record<string, unknown> = { ...VALID };
      delete partial[key];
      expect(SessionDtoSchema.safeParse(partial).success).toBe(false);
    }
  });
});

describe("SessionDtoSchema — closed to extra fields", () => {
  // .strict() turns an accidental backend field into a loud failure rather than
  // a quiet leak of learner data into the CRM client.
  it.each([
    ["User.id", { id: "usr_123" }],
    ["email", { email: "someone@example.test" }],
    ["UserRole", { userRole: "student" }],
    ["xp", { xp: 4200 }],
    ["level", { level: 7 }],
    ["status", { status: "active" }],
    ["avatar", { avatar: "https://cdn.example.test/a.png" }],
    ["token", { token: "secret" }],
  ])("rejects an extra %s field", (_label, patch) => {
    expect(withField(patch as Record<string, unknown>).success).toBe(false);
  });

  it("rejects a non-object body", () => {
    for (const body of [null, undefined, "string", 42, []]) {
      expect(SessionDtoSchema.safeParse(body).success).toBe(false);
    }
  });
});
