import type { StaffRole } from "@prisma/client";

// Canonical CRM staff roles — exactly nine, in the locked contract order.
// This is the single source of truth for the StaffRole axis. It is deliberately
// separate from the learner/admin UserRole enum and never derived from it.
export const CRM_STAFF_ROLES = [
  "crm_admin",
  "crm_manager",
  "retention_manager",
  "mentor",
  "support",
  "moderator",
  "analyst",
  "content_manager",
  "read_only",
] as const;

export type CrmStaffRole = (typeof CRM_STAFF_ROLES)[number];

// Canonical CRM permissions — exactly ten. The array order is the stable,
// canonical order in which effectivePermissions are always returned. The first
// eight keep their accepted relative order; Notes v1 appends the last two.
//
// `edit_user_notes` predates Notes v1 and is deliberately NOT reused for it. It
// stays reserved for the future mutating operations on an existing note (edit,
// delete, pin/unpin, visibility). Notes v1 is append-only, so it needs a read
// permission and a create permission that are independent of it.
export const CRM_PERMISSIONS = [
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
] as const;

export type CrmPermission = (typeof CRM_PERMISSIONS)[number];

// Compile-time proof that the canonical CrmStaffRole union and the Prisma
// StaffRole enum stay identical. If either drifts, this stops compiling.
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _staffRoleParity: AssertEqual<CrmStaffRole, StaffRole> = true;
void _staffRoleParity;

// Locked role -> permission matrix. Typed as a full Record so every StaffRole
// must have an explicit entry (a missing role stops compiling). Do not widen
// these sets by intuition — they are a fixed product contract.
export const STAFF_ROLE_PERMISSIONS: Record<CrmStaffRole, readonly CrmPermission[]> = {
  crm_admin: [
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
  ],
  crm_manager: [
    "view_exact_financials",
    "view_identity_full_email",
    "reveal_pii",
    "assign_owner",
    "export",
    "view_audit",
    "edit_user_notes",
    "view_user_notes",
    "create_user_notes",
  ],
  retention_manager: [
    "view_exact_financials",
    "view_identity_full_email",
    "reveal_pii",
    "assign_owner",
    "export",
    "edit_user_notes",
    "view_user_notes",
    "create_user_notes",
  ],
  // mentor holds nothing: an accepted product decision for Notes v1. Mentors
  // have no CRM permission today, so granting note access here would be a new
  // expansion rather than a port of an existing grant.
  mentor: [],
  support: ["edit_user_notes", "view_user_notes", "create_user_notes"],
  moderator: [],
  analyst: [],
  content_manager: [],
  read_only: [],
};

// Server-side resolver — the only place effectivePermissions are computed.
// Returns permissions in the canonical CRM_PERMISSIONS order and fails closed
// for any unknown role (empty permission set, never a partial or guessed one).
export function resolveEffectivePermissions(role: string): CrmPermission[] {
  const granted = (STAFF_ROLE_PERMISSIONS as Record<string, readonly CrmPermission[]>)[role];
  if (!granted) {
    return [];
  }
  const grantedSet = new Set<CrmPermission>(granted);
  return CRM_PERMISSIONS.filter((permission) => grantedSet.has(permission));
}

export function isCrmStaffRole(value: string): value is CrmStaffRole {
  return (CRM_STAFF_ROLES as readonly string[]).includes(value);
}
