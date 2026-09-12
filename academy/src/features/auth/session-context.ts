"use client";

import { createContext } from "react";
import type { SessionState } from "@/features/auth/session-machine";
import type { AcademyViewer } from "@/lib/api/viewer";

export type SessionContextValue = {
  state: SessionState;
  viewer: AcademyViewer | null;
  /** Re-confirm the session from the Backend (used after login / on demand). */
  refresh: () => Promise<void>;
  /** Server logout mutation, then clear in-memory viewer and return to /login. */
  logout: () => Promise<void>;
  /** Mark the session expired (e.g. a protected call returned 401). */
  expire: () => void;
};

export const SessionContext = createContext<SessionContextValue | null>(null);
