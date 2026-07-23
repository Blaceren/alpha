"use client";

import { useContext } from "react";
import { SessionContext, type SessionContextValue } from "@/features/auth/session-context";

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error("useSession must be used within a <SessionProvider>.");
  }
  return value;
}

/** Non-throwing variant for optional shell controls that may render outside a provider. */
export function useOptionalSession(): SessionContextValue | null {
  return useContext(SessionContext);
}
