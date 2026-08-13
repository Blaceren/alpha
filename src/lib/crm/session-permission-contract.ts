/**
 * CANONICAL CRM SESSION PERMISSION CONTRACT — G4-R7.
 *
 * ============================================================================
 * THIS FILE IS BYTE-IDENTICAL IN TWO REPOSITORIES.
 *
 *   backend  src/lib/crm/session-permission-contract.ts
 *   crm      src/domain/identity/crm-session-permission-contract.ts
 *
 * It is the single canonical vocabulary of permissions that may appear in
 * `effectivePermissions` of `GET /api/crm/v1/session`. Editing one copy without
 * the other is the exact defect this file exists to prevent, so `DIGEST` below
 * is the token that proves the two copies are the same artifact. Compare them
 * with `scripts/ops/verifyCrmSessionPermissionContract.ts` in the backend repo.
 * ============================================================================
 *
 * WHY THIS FILE EXISTS — G4-R7, and what it cost.
 *
 * The backend's `CRM_PERMISSIONS` grew twice (PHASE-G0 added `curriculum_read`,
 * `curriculum_author` and `curriculum_approve`; PHASE-G2 added
 * `curriculum_source_authority`) while the CRM's session vocabulary did not.
 * The CRM validates the session response with a CLOSED enum, so every principal
 * whose role granted any of those four permissions stopped being able to hold a
 * CRM session at all — `crm_admin`, `crm_manager`, `content_manager` and
 * `read_only` all logged in successfully and were then refused by their own
 * client. It blocked the G4 controlled PREPROD cutover before its first live
 * mutation, because no principal remained that could both hold a session and
 * reach the Growth workspace.
 *
 * The two sides had a written agreement to stay in step and no mechanism to
 * enforce it. A comment is not a mechanism. This file plus its parity
 * assertions is.
 *
 * WHAT THIS FILE IS NOT.
 *
 * It is a VOCABULARY, not a grant. Listing a permission here says the session
 * parser must be able to READ it; it says nothing about which role HOLDS it.
 * Role grants live in exactly one place — the backend's
 * `STAFF_ROLE_PERMISSIONS` — and adding a name here can never widen them.
 *
 * ORDER IS PART OF THE PROTOCOL, IDENTITY IS NOT.
 *
 * `resolveEffectivePermissions` returns permissions in this array's order, and
 * the backend's own regressions pin the leading positions, so the order is a
 * deliberate, versioned property: new entries are APPENDED, never inserted.
 * But nothing resolves a permission BY POSITION — every check in both
 * repositories is by name (`Set.has`, `Array.includes`, `z.enum` membership).
 * A reordering would therefore be a protocol break, not a change of meaning,
 * and the contract tests assert both halves of that separately.
 *
 * HOW TO ADD A PERMISSION.
 *
 *   1. append it to `CRM_SESSION_PERMISSION_CONTRACT` below — never insert;
 *   2. recompute `CRM_SESSION_PERMISSION_CONTRACT_DIGEST` (the tests print the
 *      expected value on failure);
 *   3. bump `CRM_SESSION_PERMISSION_CONTRACT_VERSION`;
 *   4. copy this file verbatim into the other repository;
 *   5. add it to the backend's `CRM_PERMISSIONS` and to the CRM's `Permission`
 *      union — both are compile-time-checked against this list, so neither can
 *      be forgotten;
 *   6. decide separately, and deliberately, which roles receive it.
 */

/**
 * The canonical vocabulary, in the canonical order. Version 2 appends the four
 * PHASE-G0/PHASE-G2 curriculum permissions that the CRM never received.
 */
export const CRM_SESSION_PERMISSION_CONTRACT = [
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
] as const;

export type CrmSessionPermission = (typeof CRM_SESSION_PERMISSION_CONTRACT)[number];

/**
 * Contract version. v1 was the implicit eleven-entry vocabulary that existed
 * before this file; v2 is the first version to be written down and enforced.
 */
export const CRM_SESSION_PERMISSION_CONTRACT_VERSION = 2;

/**
 * `sha256(CRM_SESSION_PERMISSION_CONTRACT.join("\n"))`, lowercase hex.
 *
 * This is the cross-repository token. Both copies of this file declare the same
 * digest; if they ever differ, the two repositories are running different
 * contracts and the session boundary is unsafe again.
 */
export const CRM_SESSION_PERMISSION_CONTRACT_DIGEST =
  "024a135cd233f97eaae4c800fced6c5c25fb674a0032c660bbb68066d3a96b9f";
