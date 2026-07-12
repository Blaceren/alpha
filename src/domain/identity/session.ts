/**
 * Typed mock employee session. Source of truth: Phase 1A spec §5.
 * Contains NO real email or personal data — synthetic only.
 */
import type { EmployeeId } from "@/domain/shared/primitives";
import type { CrmRole } from "@/domain/identity/roles";

export interface EmployeeSession {
  employeeId: EmployeeId;
  displayName: string;
  role: CrmRole;
  /** Two-letter initials for the avatar. */
  avatarInitials: string;
  locale: string;
  timezone: string;
  /** Always true in Phase 1A — signals mock/DEMO mode in the UI. */
  demoMode: boolean;
}

/** Default synthetic session used when the shell boots in mock mode. */
export const DEFAULT_MOCK_SESSION: EmployeeSession = {
  employeeId: "emp_mock_admin",
  displayName: "Demo Operator",
  role: "crm_admin",
  avatarInitials: "DO",
  locale: "ru-RU",
  timezone: "Europe/Amsterdam",
  demoMode: true,
};

/** Build a mock session for a given role (used by the dev-only role switch). */
export function mockSessionForRole(role: CrmRole): EmployeeSession {
  return { ...DEFAULT_MOCK_SESSION, role };
}
