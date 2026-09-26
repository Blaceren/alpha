import { describe, it, expect } from "vitest";
import { toAcademyViewer, FIXTURE_VIEWER } from "@/lib/api/viewer";
import {
  isBackendSessionResponse,
  isBackendLoginResponse,
  isBackendPublicUser,
  isBackendCsrfResponse,
} from "@/lib/api/types";

describe("toAcademyViewer", () => {
  it("maps only display-safe fields and stringifies the id", () => {
    const viewer = toAcademyViewer({ id: 42, name: "Артём", role: "user", status: "active" });
    expect(viewer).toEqual({ id: "42", name: "Артём", role: "user", status: "active", synthetic: false });
  });

  it("omits progression/PII fields entirely (no email/level/xp keys)", () => {
    const viewer = toAcademyViewer({ id: 1, name: "X", role: "user" });
    expect(Object.keys(viewer).sort()).toEqual(["id", "name", "role", "status", "synthetic"].sort());
    expect(viewer.status).toBeNull();
  });

  it("marks the fixture viewer as synthetic", () => {
    expect(FIXTURE_VIEWER.synthetic).toBe(true);
  });
});

describe("type guards", () => {
  it("accepts a valid session response with a user", () => {
    expect(isBackendSessionResponse({ user: { id: 1, name: "A", role: "user" } })).toBe(true);
  });

  it("accepts an unauthenticated session response", () => {
    expect(isBackendSessionResponse({ user: null })).toBe(true);
  });

  it("rejects a session response missing the user key", () => {
    expect(isBackendSessionResponse({})).toBe(false);
  });

  it("rejects a public user with a wrong id type", () => {
    expect(isBackendPublicUser({ id: "1", name: "A", role: "user" })).toBe(false);
  });

  it("validates login and csrf responses", () => {
    expect(isBackendLoginResponse({ user: { id: 1, name: "A", role: "user" } })).toBe(true);
    expect(isBackendLoginResponse({ user: null })).toBe(false);
    expect(isBackendCsrfResponse({ csrfToken: "abc" })).toBe(true);
    expect(isBackendCsrfResponse({ csrfToken: "" })).toBe(false);
  });
});
