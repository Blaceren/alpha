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
  ],
  crm_manager: [
    "view_exact_financials",
    "view_identity_full_email",
    "reveal_pii",
    "assign_owner",
    "export",
    "view_audit",
    "edit_user_notes",
  ],
  retention_manager: [
    "view_exact_financials",
    "view_identity_full_email",
    "reveal_pii",
    "assign_owner",
    "export",
    "edit_user_notes",
  ],
  mentor: [],
  support: ["edit_user_notes"],
  moderator: [],
  analyst: [],
  content_manager: [],
  read_only: [],
};
