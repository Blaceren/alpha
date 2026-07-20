/**
 * CRM roles and permission primitives.
 * Source of truth: docs/ROLE_PERMISSION_MATRIX.md.
 *
 * NOTE: This is a frontend visibility model for Phase 1A mock mode. It is NOT
 * production security. Real authorization is enforced by the future backend API.
 */

export type CrmRole =
  | "crm_admin"
  | "crm_manager"
  | "retention_manager"
  | "mentor"
  | "support"
  | "moderator"
  | "analyst"
  | "content_manager"
  | "read_only";

export const CRM_ROLES: readonly CrmRole[] = [
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

export const CRM_ROLE_LABEL: Record<CrmRole, string> = {
  crm_admin: "Администратор CRM",
  crm_manager: "Менеджер CRM",
  retention_manager: "Retention-менеджер",
  mentor: "Mentor",
  support: "Support",
  moderator: "Moderator",
  analyst: "Аналитик",
  content_manager: "Контент-менеджер",
  read_only: "Только просмотр",
};

/** Navigable sections (docs/CRM_INFORMATION_ARCHITECTURE.md §1). */
export type SectionKey =
  | "today"
  | "users"
  | "segments"
  | "tasks"
  | "cases"
  | "mentor"
  | "support"
  | "financial"
  | "communications"
  | "automations"
  | "analytics"
  | "audit"
  | "settings";

/**
 * Discrete permissions checked by the centralized permission layer.
 * Kept intentionally small for Phase 1A; extend as later phases need them.
 */
export type Permission =
  | "view_exact_financials"
  | "view_identity_full_email"
  | "reveal_pii"
  | "assign_owner"
  | "export"
  | "view_audit"
  | "manage_settings"
  /**
   * Edit dimension of ROLE_PERMISSION_MATRIX §1, narrowed to notes — the only
   * entity Phase 1B4-A can write. Tasks, cases, lifecycle override and owner
   * assignment get their own permissions when they get their own mutations;
   * `assign_owner` is a different dimension and is never reused for editing.
   */
  | "edit_user_notes"
  /**
   * CRM User Notes v1 (backend migration 31). Read and create are SEPARATE
   * permissions and neither is implied by the other. `edit_user_notes` above
   * stays reserved for future mutation of an EXISTING note (edit, delete,
   * pin/unpin, visibility) and grants neither of these.
   */
  | "view_user_notes"
  | "create_user_notes";
