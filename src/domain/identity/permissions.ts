/**
 * Centralized permission layer. Source of truth: docs/ROLE_PERMISSION_MATRIX.md.
 * All access checks go through this module — never scattered across JSX.
 *
 * Phase 1A frontend visibility only. NOT production security (DECISIONS D-12).
 */
import type { CrmRole, Permission, SectionKey } from "@/domain/identity/roles";

/**
 * Section visibility per role (ROLE_PERMISSION_MATRIX §2). `true` = section is
 * shown in navigation and reachable; `false` = hidden for that role.
 */
export const SECTION_VISIBILITY: Record<SectionKey, readonly CrmRole[]> = {
  today: [
    "crm_admin",
    "crm_manager",
    "retention_manager",
    "mentor",
    "support",
    "moderator",
    "analyst",
    "content_manager",
    "read_only",
    // PHASE-1 ADMIN. The progression operator is added to `today` and `users`
    // and to NO other section: reaching a learner is the whole of what the role
    // needs, and every other section here (audit, financial, settings, cases,
    // segments, communications, automations, mentor, support, tasks) is a power
    // it deliberately does not have. This map drives the MOCK shell only — the
    // api shell PREPROD runs reads `API_NAV_ITEMS`, where «Пользователи» already
    // carries no permission requirement.
    "progression_operator",
  ],
  users: [
    "crm_admin",
    "crm_manager",
    "retention_manager",
    "mentor",
    "support",
    "moderator",
    "analyst",
    "content_manager",
    "read_only",
    // PHASE-1 ADMIN. The progression operator is added to `today` and `users`
    // and to NO other section: reaching a learner is the whole of what the role
    // needs, and every other section here (audit, financial, settings, cases,
    // segments, communications, automations, mentor, support, tasks) is a power
    // it deliberately does not have. This map drives the MOCK shell only — the
    // api shell PREPROD runs reads `API_NAV_ITEMS`, where «Пользователи» already
    // carries no permission requirement.
    "progression_operator",
  ],
  segments: ["crm_admin", "crm_manager", "retention_manager", "analyst", "read_only"],
  tasks: [
    "crm_admin",
    "crm_manager",
    "retention_manager",
    "mentor",
    "support",
    "moderator",
    "content_manager",
  ],
  cases: [
    "crm_admin",
    "crm_manager",
    "retention_manager",
    "mentor",
    "support",
    "moderator",
  ],
  mentor: ["crm_admin", "crm_manager", "retention_manager", "mentor"],
  support: ["crm_admin", "crm_manager", "retention_manager", "support"],
  // COMMUNITY-V1. Visible to the two roles that hold `community_moderate` and
  // to nobody else. Frontend visibility is NOT the security boundary (D-12) —
  // the backend asserts the permission on every request — but a section a role
  // cannot act in should not be in its navigation either.
  community_moderation: ["crm_admin", "moderator"],
  financial: ["crm_admin", "crm_manager", "retention_manager", "support", "analyst"],
  communications: [
    "crm_admin",
    "crm_manager",
    "retention_manager",
    "support",
    "analyst",
  ],
  automations: ["crm_admin", "crm_manager", "retention_manager", "analyst"],
  analytics: ["crm_admin", "crm_manager", "retention_manager", "analyst", "read_only"],
  /**
   * AFD-5A. Exactly the roles the BACKEND grants `view_affiliate_analytics` —
   * crm_admin, crm_manager and analyst — so navigation canon and the real
   * authorization gate cannot disagree. `retention_manager` and `read_only` are
   * deliberately absent even though they appear under `analytics`: the backend
   * refuses them, and showing a section that answers 403 would be a lie.
   */
  affiliates: ["crm_admin", "crm_manager", "analyst"],
  // G4-GROWTH. The same three roles as `affiliates`: growth measurement is
  // commercially sensitive and is not something every staff role needs. A
  // mentor or a support agent has no workflow that requires knowing which
  // campaign produced which deposit.
  growth: ["crm_admin", "crm_manager", "analyst"],
  audit: [
    "crm_admin",
    "crm_manager",
    "retention_manager",
    "mentor",
    "support",
    "moderator",
    "analyst",
  ],
  settings: ["crm_admin", "crm_manager"],
};

/**
 * Discrete permissions per role (ROLE_PERMISSION_MATRIX §1, §5; DECISIONS D-07/D-08/D-11).
 * `support` can gain exact financials / PII reveal only through a separate grant,
 * which is NOT modeled by default in Phase 1A.
 *
 * `edit_user_notes` reads the Edit column of §1 literally (DECISIONS D-53).
 * Edit=Full covers every CRM entity, so admin/manager/retention hold it. Among the
 * Edit=Limited roles the parenthetical enumerates which entities the limit admits,
 * and `support` is the only one that names notes ("support cases/tasks/notes");
 * mentor ("mentor tasks/cases, reports"), moderator ("moderation cases") and
 * content_manager ("content-related") do not, so they do not get it. Edit=None
 * (analyst, read_only) never does.
 */
export const ROLE_PERMISSIONS: Record<CrmRole, readonly Permission[]> = {
  crm_admin: [
    "view_exact_financials",
    "view_identity_full_email",
    "reveal_pii",
    "assign_owner",
    "export",
    "view_audit",
    "manage_settings",
    "edit_user_notes",
    "view_affiliate_analytics",
    "learner_ops_view",
    "learner_ops_handle",
    "learner_ops_report_review",
    "learner_ops_mentor_review",
    "learner_ops_escalate",
    "learner_ops_manage_queues",
    "learner_ops_qa",
    "learner_ops_analytics",
    "learner_ops_admin",
    "learner_ops_escalation_resolve",
    // COMMUNITY-V1. Mirrors the backend grant. This map is the MOCK shell's
    // view; api mode reads `session.effectivePermissions` from the backend, so
    // PREPROD never depended on this line — but two role maps that disagree is
    // the same trap as two navigation lists, and one of those already cost this
    // repository a section nobody could reach.
    "community_moderate",
  ],
  crm_manager: [
    "view_exact_financials",
    "view_identity_full_email",
    "reveal_pii",
    "assign_owner",
    "export",
    "view_audit",
    "edit_user_notes",
    "view_affiliate_analytics",
    "learner_ops_view",
    "learner_ops_handle",
    "learner_ops_escalate",
    "learner_ops_manage_queues",
    "learner_ops_qa",
    "learner_ops_analytics",
    "learner_ops_escalation_resolve",
  ],
  retention_manager: [
    "view_exact_financials",
    "view_identity_full_email",
    "reveal_pii",
    "assign_owner",
    "export",
    "edit_user_notes",
    "learner_ops_view",
    "learner_ops_handle",
  ],
  mentor: [
    "learner_ops_view",
    "learner_ops_handle",
    "learner_ops_report_review",
    "learner_ops_mentor_review",
    // Resolve, never raise — mirroring the backend matrix exactly.
    "learner_ops_escalation_resolve",
  ],
  support: [
    "edit_user_notes",
    "learner_ops_view",
    "learner_ops_handle",
    "learner_ops_escalate",
  ],
  // COMMUNITY-V1 — `moderator` receives its first permission here too, matching
  // the backend's grant exactly: Community moderation and nothing else.
  moderator: ["community_moderate"],
  // AFD-5A — analyst's first permission, mirroring the backend matrix. Read
  // only: no `manage_settings`, so every affiliate mutation is refused.
  analyst: [
    "view_affiliate_analytics",
    "learner_ops_analytics",
  ],
  content_manager: [],
  read_only: [
    "learner_ops_view",
  ],
  // PHASE-1 ADMIN — mirrors the backend grant exactly: one permission, nothing
  // else. Notably NOT `learner_ops_view`; the progression read gate accepts the
  // override permission on its own, so this role can inspect what it corrects
  // without gaining the Learner Operations workspace.
  progression_operator: ["curriculum_progress_override"],
};
