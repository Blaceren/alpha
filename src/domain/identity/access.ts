/**
 * Permission helpers — the single typed access layer used by the whole app.
 * Source of truth: docs/ROLE_PERMISSION_MATRIX.md (via permissions.ts).
 *
 * Reminder: frontend visibility only in Phase 1A. NOT production security.
 */
import type { CrmRole, Permission, SectionKey } from "@/domain/identity/roles";
import {
  ROLE_PERMISSIONS,
  SECTION_VISIBILITY,
} from "@/domain/identity/permissions";

export function hasPermission(role: CrmRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function canViewSection(role: CrmRole, section: SectionKey): boolean {
  return SECTION_VISIBILITY[section].includes(role);
}

export function visibleSections(role: CrmRole, order: SectionKey[]): SectionKey[] {
  return order.filter((s) => canViewSection(role, s));
}

export function canViewExactFinancials(role: CrmRole): boolean {
  return hasPermission(role, "view_exact_financials");
}

export function canViewIdentity(role: CrmRole): boolean {
  return hasPermission(role, "view_identity_full_email");
}

export function canRevealPii(role: CrmRole): boolean {
  return hasPermission(role, "reveal_pii");
}

export function canAssignOwner(role: CrmRole): boolean {
  return hasPermission(role, "assign_owner");
}

export function canExport(role: CrmRole): boolean {
  return hasPermission(role, "export");
}

export function canViewAudit(role: CrmRole): boolean {
  return hasPermission(role, "view_audit");
}

export function canManageSettings(role: CrmRole): boolean {
  return hasPermission(role, "manage_settings");
}
