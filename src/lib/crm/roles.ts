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
// PHASE-G0 appends the three curriculum-authoring permissions, again APPENDED
// rather than inserted so the existing canonical order is untouched and no
// client that pinned the first eleven positions changes meaning.
//
// THEY ARE THREE, NOT ONE, BECAUSE FOUR-EYES REVIEW NEEDS THEM SEPARATE.
// `curriculum_read` is "may look at authoring surfaces", `curriculum_author` is
// "may write a draft and submit it", `curriculum_approve` is "may accept work as
// editorial truth". Collapsing author and approve into a single
// `manage_curriculum` would make every editor their own reviewer, which is the
// exact failure the self-approval rule exists to prevent -- and a rule enforced
// in the domain but contradicted by the permission model is a rule waiting to be
// argued away.
//
// NONE OF THEM IMPLIES ANOTHER. An approver who may not read would be a broken
// contract, so the grant matrix below gives `curriculum_read` to every role that
// holds either of the other two, explicitly, rather than by derivation.
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
  "curriculum_read",
  "curriculum_author",
  "curriculum_approve",
  // PHASE-G2 FOUNDATION — deciding which of two competing SOURCES is authority
  // for a field. Deliberately its own permission rather than a reuse of
  // `curriculum_author` or `curriculum_approve`: authoring writes a draft,
  // approval accepts a draft as editorial truth, and neither of those is
  // "the Blueprint and the approved package disagree and this is the one that
  // wins". Folding it into either would let a role that may only write drafts
  // decide what the product's source of truth IS, or would make adjudication
  // count as the editorial approval that §13 requires stay separate.
  "curriculum_source_authority",
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
// PHASE-G0 GRANT RULE FOR THE THREE CURRICULUM PERMISSIONS. Every grant below is
// derivable from a marker the matrix ALREADY carries, never from intuition about
// what a role name sounds like.
//
//   • `curriculum_source_authority` -> `crm_admin` ONLY, and derived from the
//     SAME marker `curriculum_approve` was: `manage_settings` is this matrix's
//     established sign of "owns configuration rather than merely reads it", and
//     `crm_admin` is the only role that holds it. Choosing between two competing
//     SOURCES is at least that weighty — it decides what the product treats as
//     its source of truth, not merely what one draft says. `content_manager` is
//     DELIBERATELY EXCLUDED: it holds `curriculum_author`, which is the marker
//     for "may write a draft and submit it", and an author who could also decide
//     which source wins would be settling the question their own draft depends
//     on. That exclusion is asserted by regression, not left to reading.
//
//   • `curriculum_approve` -> `crm_admin` ONLY.
//     The matrix's own marker for "owns configuration rather than merely reads
//     it" is `manage_settings`, and `crm_admin` is the ONLY role that holds it.
//     Editorial approval is exactly that kind of authority: it decides what the
//     product will teach. `crm_manager` was considered and DELIBERATELY
//     EXCLUDED — it holds `view_audit`, which AFD-5A established as the marker
//     for broad supervisory READ, not for authority, and it does not hold
//     `manage_settings`. Granting approval on a read marker would be the first
//     time this matrix widened an authority on a read discriminator.
//
//   • `curriculum_author` -> `content_manager` and `crm_admin`.
//     `content_manager` is the accepted product decision for this phase and this
//     is its FIRST permission, so the authoring gate demonstrably cannot be
//     satisfied by any pre-existing grant. `crm_admin` receives it because an
//     administrator who cannot fix a typo would route every correction through
//     someone else — and the self-approval rule (see below) means this grant
//     REMOVES rather than adds power in the case that matters: an admin who
//     authors a revision can no longer approve that revision.
//
//   • `curriculum_read` -> the two roles above, plus `crm_manager` (holds
//     `view_audit`, the established broad-supervisory-read marker) and
//     `read_only`, whose entire product meaning is "may look, may not touch".
//     `read_only` gaining its first permission is the point: a read-only role
//     receiving a read permission cannot widen anything, and the regression
//     proves it still cannot mutate.
//
// EXPLICITLY NOT GRANTED ANYTHING: `mentor`, `support`, `moderator`,
// `retention_manager` and `analyst`. Mentors and support hold learner-facing
// duties and must never gain authority over what the curriculum says. `analyst`
// is the analytics role — `view_affiliate_analytics` is about affiliate traffic,
// not about teaching material, so it implies nothing here. No role gains
// `manage_settings`, and no existing grant is modified.
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
    "curriculum_read",
    "curriculum_author",
    "curriculum_approve",
    "curriculum_source_authority",
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
    "curriculum_read",
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
  // expansion rather than a port of an existing grant. PHASE-G0 keeps it that
  // way — a mentor reviews LEARNERS, never the curriculum.
  mentor: [],
  support: ["edit_user_notes", "view_user_notes", "create_user_notes"],
  moderator: [],
  // AFD-5A gives analyst its first permission — read-only affiliate inventory.
  // Deliberately NOT `manage_settings`: an analyst may inspect configuration and
  // must not be able to change it.
  analyst: ["view_affiliate_analytics"],
  // PHASE-G0 — the content role's first permissions. Author, never approve.
  content_manager: ["curriculum_read", "curriculum_author"],
  // PHASE-G0 — read_only's first permission, and the only kind it may ever hold.
  read_only: ["curriculum_read"],
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

/* ------------------------------------------- Curriculum authoring PHASE-G0 */

// The three curriculum-authoring gates. Each requires EXACTLY its own
// permission, with no fallback and no implication chain.
//
// `manage_settings` is deliberately NOT an alternative for any of them, unlike
// `canViewAffiliates` above. There the owner of a configuration surface plainly
// had to be able to read it. Here, letting the general administration
// permission stand in for `curriculum_approve` would silently reintroduce the
// single-permission model these three were split to avoid, and would make the
// four-eyes rule depend on which permission a caller happened to hold.
//
// Authorization is purely permission-based. No StaffRole name, no email, no
// User.role and no client-supplied permission list is consulted here or by any
// caller — the permission set always comes from `resolveEffectivePermissions`
// applied to the STORED staff role.
export function canReadCurriculumAuthoring(permissions: readonly CrmPermission[]): boolean {
  return permissions.includes("curriculum_read");
}

export function canAuthorCurriculum(permissions: readonly CrmPermission[]): boolean {
  return permissions.includes("curriculum_author");
}

export function canApproveCurriculum(permissions: readonly CrmPermission[]): boolean {
  return permissions.includes("curriculum_approve");
}

/* ------------------------------------ Source-authority adjudication PHASE-G2 */

// Requires EXACTLY `curriculum_source_authority`, with no fallback and no
// implication chain — the same rule the three gates above follow.
//
// `curriculum_approve` is deliberately NOT an alternative. The two answer
// different questions and are held today by the same single role only by
// coincidence of the grant matrix. If a future product decision widened
// approval to a second role, an implication chain here would silently widen who
// may decide which SOURCE is canon, which is not a decision anyone should
// acquire as a side effect.
export function canAdjudicateCurriculumSourceAuthority(
  permissions: readonly CrmPermission[],
): boolean {
  return permissions.includes("curriculum_source_authority");
}
