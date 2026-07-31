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

  it("accepts all ten canonical permissions at once", () => {
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

describe("Notes v1 permission schema", () => {
  it("declares exactly eleven permissions in the backend's canonical order", () => {
    // AFD-5A appended view_affiliate_analytics. This list must track the
    // backend's CRM_PERMISSIONS exactly: because PermissionSchema is a closed
    // enum, a missing entry makes the whole session response fail to parse and
    // logs the operator out.
    expect([...SESSION_PERMISSIONS]).toEqual([
      "view_exact_financials",
      "view_identity_full_email",
      "reveal_pii",
      "assign_owner",
      "export",
      "view_audit",
      "manage_settings",
      "edit_user_notes",
      "view_user_notes",
      "create_user_notes",
      "view_affiliate_analytics",
    ]);
  });

  it("keeps the ten pre-AFD-5A permissions in their exact prior order", () => {
    expect(SESSION_PERMISSIONS.slice(0, 10)).toEqual([
      "view_exact_financials",
      "view_identity_full_email",
      "reveal_pii",
      "assign_owner",
      "export",
      "view_audit",
      "manage_settings",
      "edit_user_notes",
      "view_user_notes",
      "create_user_notes",
    ]);
  });

  it("keeps the accepted first eight in their exact prior order", () => {
    expect(SESSION_PERMISSIONS.slice(0, 8)).toEqual([
      "view_exact_financials",
      "view_identity_full_email",
      "reveal_pii",
      "assign_owner",
      "export",
      "view_audit",
      "manage_settings",
      "edit_user_notes",
    ]);
  });

  it.each(["view_user_notes", "create_user_notes"])("accepts the new permission %s", (perm) => {
    expect(withField({ effectivePermissions: [perm] }).success).toBe(true);
  });

  it("accepts either Notes permission on its own — neither implies the other", () => {
    expect(withField({ effectivePermissions: ["view_user_notes"] }).success).toBe(true);
    expect(withField({ effectivePermissions: ["create_user_notes"] }).success).toBe(true);
  });

  it("still rejects an unknown permission", () => {
    expect(withField({ effectivePermissions: ["delete_user_notes"] }).success).toBe(false);
    expect(withField({ effectivePermissions: ["manage_notes"] }).success).toBe(false);
  });

  it("still rejects duplicates, including of the new values", () => {
    expect(
      withField({ effectivePermissions: ["view_user_notes", "view_user_notes"] }).success,
    ).toBe(false);
  });

  it("leaves permissionVersion semantics untouched", () => {
    expect(withField({ permissionVersion: 1 }).success).toBe(true);
    expect(withField({ permissionVersion: 0 }).success).toBe(false);
    expect(withField({ permissionVersion: -1 }).success).toBe(false);
  });
});
