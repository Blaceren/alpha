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
  /** Dev-only: switch the mock role to preview frontend visibility. NOT production RBAC. */
  setRole: (role: CrmRole) => void;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

const STORAGE_KEY = "ata-crm.mock-role.v1";

export function SessionProvider({ children }: { children: React.ReactNode }) {
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

export function useSession(): SessionContextValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>.");
  return ctx;
}
