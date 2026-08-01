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

// Canonical CRM permissions — exactly eleven. The array order is the stable,
// canonical order in which effectivePermissions are always returned. The first
// eight keep their accepted relative order; Notes v1 appended two more; AFD-5A
// appends the last one.
//
// `edit_user_notes` predates Notes v1 and is deliberately NOT reused for it. It
// stays reserved for the future mutating operations on an existing note (edit,
// delete, pin/unpin, visibility). Notes v1 is append-only, so it needs a read
// permission and a create permission that are independent of it.
//
// `view_affiliate_analytics` (AFD-5A) is a READ permission over the affiliate
// inventory — partners, campaigns, tracking links and, from AFD-5B, their
// traffic analytics. It is APPENDED rather than inserted so the existing
// canonical order is untouched and no client that pinned the first ten
// positions changes meaning. It grants nothing beyond reading: every affiliate
// mutation continues to require `manage_settings`, which is deliberately NOT
// broadened here.
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
  "view_affiliate_analytics",
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
//
// AFD-5A GRANT RULE FOR `view_affiliate_analytics`. Three roles receive it, and
// each for a reason the matrix itself proves rather than intuition:
//
//   • `analyst`   — the designated analytics role. AFD-5A exists to give it
//                   read access to the affiliate inventory, and this is its
//                   FIRST permission: it previously held none, so the grant
//                   also proves the read gate cannot be satisfied by
//                   `manage_settings` alone.
//   • `crm_admin` — already owns affiliate configuration through
//                   `manage_settings`; withholding the read permission would
//                   make the read gate depend on the mutation permission.
//   • `crm_manager` — the only NON-admin role holding `view_audit`, which is
//                   this matrix's own marker for broad supervisory read
//                   (`retention_manager` holds `export` and
//                   `view_exact_financials` but NOT `view_audit`, and so is
//                   deliberately excluded). Granting on that existing
//                   discriminator keeps the decision derivable from the matrix.
//
// Every other role is untouched. `mentor`, `support`, `moderator`,
// `content_manager` and `read_only` receive nothing, and no role gains
// `manage_settings`.
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
    "view_affiliate_analytics",
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
    "view_affiliate_analytics",
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
  // AFD-5A gives analyst its first permission — read-only affiliate inventory.
  // Deliberately NOT `manage_settings`: an analyst may inspect configuration and
  // must not be able to change it.
  analyst: ["view_affiliate_analytics"],
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

// ---------------------------------------------------------------- Owner v1

// Eligible owner StaffRoles — a fixed product decision for CRM Learner Owner v1.
// This is a DOMAIN rule for who may be a candidate/owner, NOT an operation
// permission: candidacy deliberately does not depend on `assign_owner`. Note the
// asymmetry — crm_admin holds `assign_owner` (may assign) but is NOT eligible as
// an owner, while mentor and support are eligible owners yet hold no
// `assign_owner` (cannot assign). Do not widen this set by intuition.
export const CRM_ELIGIBLE_OWNER_ROLES: readonly CrmStaffRole[] = [
  "crm_manager",
  "retention_manager",
  "mentor",
  "support",
] as const;

export function isEligibleOwnerRole(role: string): role is CrmStaffRole {
  return (CRM_ELIGIBLE_OWNER_ROLES as readonly string[]).includes(role);
}

// Narrow authorization gate for the two Owner mutation-side operations:
// listing candidates and PUT owner. Both require exactly `assign_owner`, which
// is held only by crm_admin, crm_manager and retention_manager. Reading the
// current owner deliberately does NOT go through here — any valid StaffProfile
// may read it. No other permission implies `assign_owner`, and no StaffRole name
// is checked here: authorization is purely permission-based.
export function canAssignOwner(permissions: readonly CrmPermission[]): boolean {
  return permissions.includes("assign_owner");
}

// ---------------------------------------------------------- Owner History OH-1

// --------------------------------------------------------- Affiliates AFD-5A

// Read gate for the affiliate inventory. Either permission satisfies it, and
// they mean different things: `view_affiliate_analytics` is "may look at
// affiliate configuration", `manage_settings` is "owns affiliate
// configuration". An owner who could not read what they administer would be an
// obviously broken contract, so `manage_settings` implies the read rather than
// requiring administrators to hold both.
//
// This is the ONLY place the read rule is expressed. Authorization is purely
// permission-based: no StaffRole name, no email, no User.role and no
// client-supplied permission list is consulted here or by any caller.
export function canViewAffiliates(permissions: readonly CrmPermission[]): boolean {
  return (
    permissions.includes("view_affiliate_analytics") || permissions.includes("manage_settings")
  );
}

/* --------------------------------------------------- Affiliate leads AFD-5B2B */

// Full-identity reveal for ONE affiliate lead.
//
// NO NEW PERMISSION WAS ADDED. `reveal_pii` already exists in the canonical
// matrix above, is named for exactly this operation, and is granted to exactly
// the three roles AFD-5B2B's contract calls for — crm_admin, crm_manager and
// retention_manager — while analyst, support, mentor, moderator,
// content_manager and read_only hold neither it nor any equivalent. Minting a
// second `view_affiliate_lead_pii` beside it would give one capability two
// owners that could later disagree, which is how a role ends up able to read
// PII through one surface and not another.
//
// `view_identity_full_email` was considered and NOT used. It is the FIELD-LEVEL
// gate the CRM user list and detail already apply when they decide whether to
// render an address, and it is held by the identical three roles — so the
// choice narrows and widens nothing. `reveal_pii` is preferred because this is
// an explicit, audited, single-record REVEAL rather than a field projection,
// and the permission whose name states that should be the one that guards it.
//
// THIS GATE IS ADDITIONAL, NEVER ALTERNATIVE. The caller must already satisfy
// `canViewAffiliates` to reach a lead at all. `view_affiliate_analytics` alone
// therefore grants no PII whatsoever, and `manage_settings` — which is
// deliberately not broadened here — does not imply this either.
export function canRevealLeadPii(permissions: readonly CrmPermission[]): boolean {
  return permissions.includes("reveal_pii");
}

// Read gate for CRM Learner Owner HISTORY. It requires exactly `view_audit`,
// held only by crm_admin and crm_manager — there is deliberately NO fallback to
// `assign_owner`, so retention_manager (which may mutate the owner) still cannot
// read the history. This reuses the existing permission and broadens no role.
export function canViewOwnerHistory(permissions: readonly CrmPermission[]): boolean {
  return permissions.includes("view_audit");
}
