import { describe, it, expect } from "vitest";
import {
  sessionReducer,
  INITIAL_SESSION_STATE,
  viewerOf,
  type SessionState,
} from "@/features/auth/session-machine";
import { makeError } from "@/lib/api/errors";
import type { AcademyViewer } from "@/lib/api/viewer";

const viewer: AcademyViewer = { id: "1", name: "A", role: "user", status: "active", synthetic: false };

describe("sessionReducer", () => {
  it("starts INITIALIZING", () => {
    expect(INITIAL_SESSION_STATE.status).toBe("INITIALIZING");
  });

  it("BOOTSTRAP_RESULT with a viewer -> AUTHENTICATED", () => {
    const state = sessionReducer(INITIAL_SESSION_STATE, { type: "BOOTSTRAP_RESULT", viewer });
    expect(state).toEqual({ status: "AUTHENTICATED", viewer });
    expect(viewerOf(state)).toEqual(viewer);
  });

  it("BOOTSTRAP_RESULT with null -> UNAUTHENTICATED", () => {
    const state = sessionReducer(INITIAL_SESSION_STATE, { type: "BOOTSTRAP_RESULT", viewer: null });
    expect(state.status).toBe("UNAUTHENTICATED");
  });

  it("BOOTSTRAP_ERROR UNAUTHENTICATED -> UNAUTHENTICATED (not ERROR)", () => {
    const state = sessionReducer(INITIAL_SESSION_STATE, {
      type: "BOOTSTRAP_ERROR",
      error: makeError("UNAUTHENTICATED"),
    });
    expect(state.status).toBe("UNAUTHENTICATED");
  });

  it("BOOTSTRAP_ERROR network -> ERROR (retryable, no fabricated session)", () => {
    const error = makeError("NETWORK_ERROR");
    const state = sessionReducer(INITIAL_SESSION_STATE, { type: "BOOTSTRAP_ERROR", error });
    expect(state).toEqual({ status: "ERROR", error });
    expect(viewerOf(state)).toBeNull();
  });

  it("SESSION_EXPIRED clears the viewer -> EXPIRED", () => {
    const authed: SessionState = { status: "AUTHENTICATED", viewer };
    const state = sessionReducer(authed, { type: "SESSION_EXPIRED" });
    expect(state.status).toBe("EXPIRED");
    expect(viewerOf(state)).toBeNull();
  });

  it("LOGGED_OUT -> UNAUTHENTICATED", () => {
    const authed: SessionState = { status: "AUTHENTICATED", viewer };
    expect(sessionReducer(authed, { type: "LOGGED_OUT" }).status).toBe("UNAUTHENTICATED");
  });

  it("RETRY -> INITIALIZING", () => {
    const error = makeError("BACKEND_UNAVAILABLE");
    const state: SessionState = { status: "ERROR", error };
    expect(sessionReducer(state, { type: "RETRY" }).status).toBe("INITIALIZING");
  });
});
