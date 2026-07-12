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
  | "manage_settings";
