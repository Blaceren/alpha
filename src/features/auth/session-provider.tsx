"use client";

import { useCallback, useReducer, type ReactNode } from "react";
import * as api from "@/lib/api/client";
import { hardReplace } from "@/lib/navigation/hard-replace";
import { toAcademyViewer } from "@/lib/api/viewer";
import {
  sessionReducer,
  viewerOf,
  type SessionState,
} from "@/features/auth/session-machine";
import { SessionContext, type SessionContextValue } from "@/features/auth/session-context";

/**
 * Client session provider.
 *
 * The server layout has already resolved the session (real viewer in api mode,
 * synthetic viewer in fixture mode), so the provider starts in a concrete state
 * and there is NO protected-content flash and no persistent auth flag in
 * browser storage. `refresh`/`logout`/`expire` drive the machine at runtime.
 */
export function SessionProvider({
  initialState,
  children,
}: {
  initialState: SessionState;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);

  const refresh = useCallback(async () => {
    dispatch({ type: "RETRY" });
    const result = await api.fetchSession();
    if (result.ok) {
      const user = result.data.user;
      dispatch({ type: "BOOTSTRAP_RESULT", viewer: user ? toAcademyViewer(user) : null });
    } else {
      dispatch({ type: "BOOTSTRAP_ERROR", error: result.error });
    }
  }, []);

  const logout = useCallback(async () => {
    // Best-effort server mutation. Whether it succeeds or the session was
    // already invalid, we clear the in-memory viewer and return to /login —
    // with a full load, so no page of this account stays in the app's memory
    // for Back to bring out (2026-10-07 audit). Drafts and tool data are never
    // touched.
    await api.logout();
    dispatch({ type: "LOGGED_OUT" });
    hardReplace("/login");
  }, []);

  const expire = useCallback(() => {
    dispatch({ type: "SESSION_EXPIRED" });
  }, []);

  const value: SessionContextValue = {
    state,
    viewer: viewerOf(state),
    refresh,
    logout,
    expire,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
