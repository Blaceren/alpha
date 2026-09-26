/**
 * Employee session — the shell's view of who is acting.
 *
 * Two producers, one shape:
 *   - mock mode  builds it locally from ROLE_PERMISSIONS (synthetic, no real data);
 *   - api mode   maps it from the validated backend session DTO.
 *
 * The single shape is the point: UI permission checks read
 * `session.effectivePermissions` and never care which producer filled it, so a
 * production affordance cannot be re-derived from a role the browser chose.
 */
import type { EmployeeId } from "@/domain/shared/primitives";
import type { CrmRole, Permission } from "@/domain/identity/roles";
import { ROLE_PERMISSIONS } from "@/domain/identity/permissions";
import type { SessionDto } from "@/domain/identity/session-dto";

export interface EmployeeSession {
  employeeId: EmployeeId;
  displayName: string;
  role: CrmRole;
  /**
   * The UI authority for permission-gated affordances. In api mode this comes
   * only from the backend; the role never re-grants anything locally.
   */
  effectivePermissions: readonly Permission[];
  /** Metadata only — never treated as a token or as authorization. */
  permissionVersion: number;
  /** Retained for diagnostics only — never a client-side authorization decision. */
  expiresAt: string;
  /** Two-letter initials for the avatar. */
  avatarInitials: string;
  locale: string;
  timezone: string;
  /** true = synthetic mock session; false = validated backend session. */
  demoMode: boolean;
}

/** Stable synthetic values so mock behaviour stays deterministic. */
export const MOCK_PERMISSION_VERSION = 1;
export const MOCK_EXPIRES_AT = "2099-12-31T23:59:59.000Z";

/** Default synthetic session used when the shell boots in mock mode. */
export const DEFAULT_MOCK_SESSION: EmployeeSession = {
  employeeId: "emp_mock_admin",
  displayName: "Demo Operator",
  role: "crm_admin",
  effectivePermissions: ROLE_PERMISSIONS.crm_admin,
  permissionVersion: MOCK_PERMISSION_VERSION,
  expiresAt: MOCK_EXPIRES_AT,
  avatarInitials: "DO",
  locale: "ru-RU",
  timezone: "Europe/Amsterdam",
  demoMode: true,
};

/**
 * Build a mock session for a given role (used by the dev-only role switch).
 * Permissions come from the local matrix, which is what keeps mock-mode
 * affordances identical to what they were before effectivePermissions existed.
 */
export function mockSessionForRole(role: CrmRole): EmployeeSession {
  return { ...DEFAULT_MOCK_SESSION, role, effectivePermissions: ROLE_PERMISSIONS[role] };
}

/** Two initials from a display name, for the avatar. */
function initialsFrom(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (first === undefined || last === undefined) return "??";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return (first.slice(0, 1) + last.slice(0, 1)).toUpperCase();
}

/**
 * Map a validated backend DTO to the session the shell uses. Every
 * authorization-relevant field comes from the DTO; nothing is defaulted from a
 * role and nothing is read from browser storage.
 */
export function sessionFromDto(dto: SessionDto): EmployeeSession {
  return {
    employeeId: dto.employeeId,
    displayName: dto.displayName,
    role: dto.role,
    effectivePermissions: dto.effectivePermissions,
    permissionVersion: dto.permissionVersion,
    expiresAt: dto.expiresAt,
    avatarInitials: initialsFrom(dto.displayName),
    locale: "ru-RU",
    timezone: "Europe/Amsterdam",
    demoMode: false,
  };
}
