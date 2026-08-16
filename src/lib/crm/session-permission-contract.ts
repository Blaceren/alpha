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
 * Version 3 appends the nine LEARNER-OPERATIONS-V1 permissions. Version 4
 * appends one more, `learner_ops_escalation_resolve`, splitting an act that was
 * wrongly fused to another.
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
  // LEARNER-OPERATIONS-V1. Nine, appended and never inserted.
  //
  // WHY NINE AND NOT ONE. A single `manage_learner_ops` would make every
  // operator their own reviewer, their own QA and their own configuration
  // owner. The operating model separates who may HANDLE work from who may
  // decide EDUCATIONAL outcomes, who may judge QUALITY and who may change the
  // rules — so the vocabulary separates them too, for the same reason
  // PHASE-G0 refused to collapse author and approve.
  //
  // WHY REVIEW APPEARS HERE AT ALL. Report-review and mentor-review authority
  // is granted today by `User.role` alone — an axis the CRM can neither
  // display nor control. These two names do not REPLACE that gate: they are
  // required IN ADDITION to it, so they can only ever narrow authority. See
  // LO-AUTH-AXIS-1 and `canPerformReportReview` in roles.ts.
  "learner_ops_view",
  "learner_ops_handle",
  "learner_ops_report_review",
  "learner_ops_mentor_review",
  "learner_ops_escalate",
  "learner_ops_manage_queues",
  "learner_ops_qa",
  "learner_ops_analytics",
  "learner_ops_admin",
  // LO-ESCALATION-RESOLVE-AUTHORITY-1, v4. Appended, never inserted.
  //
  // RAISING AN ESCALATION AND ANSWERING ONE ARE DIFFERENT RESPONSIBILITIES.
  // `learner_ops_escalate` gated both, and the grant matrix gave it to the
  // frontline that raises and to the administrators, but not to `mentor` — the
  // role an `educational_methodology` escalation is addressed TO. The authority
  // the question was routed to was the one authority that could not answer it,
  // while the frontline that raised it could close its own escalation. That is
  // self-certification, and it is what escalating exists to prevent.
  //
  // So resolution gets its own name. `learner_ops_escalate` keeps its stated
  // meaning — may raise an escalation to another authority — and every current
  // holder keeps it unchanged. Nobody gains resolution by holding the old
  // permission, and nobody loses the ability to raise.
  "learner_ops_escalation_resolve",
] as const;

export type CrmSessionPermission = (typeof CRM_SESSION_PERMISSION_CONTRACT)[number];

/**
 * Contract version. v1 was the implicit eleven-entry vocabulary that existed
 * before this file; v2 is the first version to be written down and enforced;
 * v3 appends the nine Learner Operations permissions, bringing the vocabulary
 * to twenty-four; v4 appends `learner_ops_escalation_resolve`, bringing it to
 * twenty-five.
 */
export const CRM_SESSION_PERMISSION_CONTRACT_VERSION = 4;

/**
 * `sha256(CRM_SESSION_PERMISSION_CONTRACT.join("\n"))`, lowercase hex.
 *
 * This is the cross-repository token. Both copies of this file declare the same
 * digest; if they ever differ, the two repositories are running different
 * contracts and the session boundary is unsafe again.
 */
export const CRM_SESSION_PERMISSION_CONTRACT_DIGEST =
  "1514e85f02224b31082bac7e596e96a5dec5682df73855224a2e072e53590110";
