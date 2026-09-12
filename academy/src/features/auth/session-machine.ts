/**
 * Pure session state machine.
 *
 * The client session is one of five explicit states. This reducer holds no
 * side effects and no browser storage — it is fully unit-testable and is the
 * single definition of legal transitions. Nothing here is persisted: a cached
 * name is display only and is never authentication evidence.
 */
import type { NormalizedError } from "@/lib/api/errors";
import type { AcademyViewer } from "@/lib/api/viewer";

export type SessionStatus =
  | "INITIALIZING"
  | "AUTHENTICATED"
  | "UNAUTHENTICATED"
  | "EXPIRED"
  | "ERROR";

export type SessionState =
  | { status: "INITIALIZING" }
  | { status: "AUTHENTICATED"; viewer: AcademyViewer }
  | { status: "UNAUTHENTICATED" }
  | { status: "EXPIRED" }
  | { status: "ERROR"; error: NormalizedError };

export type SessionEvent =
  | { type: "BOOTSTRAP_RESULT"; viewer: AcademyViewer | null }
  | { type: "BOOTSTRAP_ERROR"; error: NormalizedError }
  | { type: "LOGGED_IN"; viewer: AcademyViewer }
  | { type: "SESSION_EXPIRED" }
  | { type: "LOGGED_OUT" }
  | { type: "RETRY" };

export const INITIAL_SESSION_STATE: SessionState = { status: "INITIALIZING" };

export function sessionReducer(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case "BOOTSTRAP_RESULT":
      return event.viewer
        ? { status: "AUTHENTICATED", viewer: event.viewer }
        : { status: "UNAUTHENTICATED" };

    case "BOOTSTRAP_ERROR":
      // An authenticated-but-rejected bootstrap is "unauthenticated"; any other
      // failure (network/backend/malformed) is a retryable ERROR, never a
      // silent redirect loop and never a fabricated session.
      return event.error.category === "UNAUTHENTICATED"
        ? { status: "UNAUTHENTICATED" }
        : { status: "ERROR", error: event.error };

    case "LOGGED_IN":
      return { status: "AUTHENTICATED", viewer: event.viewer };

    case "SESSION_EXPIRED":
      // Clear the in-memory viewer; the intended route is preserved by the
      // caller (router), not by this reducer.
      return { status: "EXPIRED" };

    case "LOGGED_OUT":
      return { status: "UNAUTHENTICATED" };

    case "RETRY":
      return { status: "INITIALIZING" };

    default:
      return state;
  }
}

export function viewerOf(state: SessionState): AcademyViewer | null {
  return state.status === "AUTHENTICATED" ? state.viewer : null;
}
