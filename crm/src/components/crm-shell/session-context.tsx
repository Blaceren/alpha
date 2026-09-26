"use client";

import * as React from "react";
import type { CrmRole } from "@/domain/identity/roles";
import {
  DEFAULT_MOCK_SESSION,
  mockSessionForRole,
  type EmployeeSession,
} from "@/domain/identity/session";

interface SessionContextValue {
  session: EmployeeSession;
  /**
   * Dev-only mock role switch. `null` in api mode — there is no local role to
   * set, and exposing a setter would imply the browser can change authority.
   */
  setRole: ((role: CrmRole) => void) | null;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

const STORAGE_KEY = "ata-crm.mock-role.v1";

/**
 * Mock-mode session provider — unchanged behaviour from Phase 1A: an immediate
 * synthetic session, with the role persisted in localStorage for the dev switch.
 *
 * This component is only ever mounted when mode === "mock". In api mode the
 * session boundary supplies a validated backend session instead, so none of the
 * localStorage code below is reachable.
 */
export function MockSessionProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = React.useState<CrmRole>(DEFAULT_MOCK_SESSION.role);

  // Restore locally persisted mock role (client-only, synthetic).
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY) as CrmRole | null;
      if (stored) setRoleState(stored);
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const setRole = React.useCallback((next: CrmRole) => {
    setRoleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const value = React.useMemo<SessionContextValue>(
    () => ({ session: mockSessionForRole(role), setRole }),
    [role, setRole],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * Publishes an already-validated session (api mode). There is no setter: the
 * backend is the only authority, and nothing here reads browser storage.
 */
export function AuthenticatedSessionProvider({
  session,
  children,
}: {
  session: EmployeeSession;
  children: React.ReactNode;
}) {
  const value = React.useMemo<SessionContextValue>(() => ({ session, setRole: null }), [session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a session provider.");
  return ctx;
}
