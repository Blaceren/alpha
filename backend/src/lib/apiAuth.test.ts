import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ createAuditLog: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(), hasRole: vi.fn() }));

const { ApiAuthError, apiAuthErrorResponse } = await import("@/lib/apiAuth");

/* 2026-10-07 audit: the catch-all of most routes answered 401 to everything that
   was not a 403, and the Academy reads a 401 as «Сеанс завершён». */
describe("apiAuthErrorResponse", () => {
  const request = new Request("https://example.test/api/notifications");

  it("answers 401 only to an authentication failure", async () => {
    expect((await apiAuthErrorResponse(new ApiAuthError(401), request)).status).toBe(401);
    expect((await apiAuthErrorResponse(new Error("UNAUTHORIZED"), request)).status).toBe(401);
  });

  it("answers 403 to a refusal", async () => {
    expect((await apiAuthErrorResponse(new ApiAuthError(403, 1, "user"), request)).status).toBe(403);
    expect((await apiAuthErrorResponse(new Error("FORBIDDEN"), request)).status).toBe(403);
  });

  it("answers anything else as a server failure, never as a signed-out learner", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const busy = Object.assign(new Error("Timed out fetching a new connection from the connection pool."), { code: "P2024" });
    for (const error of [busy, new TypeError("x is undefined"), "a string"]) {
      const response = await apiAuthErrorResponse(error, request);
      expect(response.status).toBe(500);
      expect(((await response.json()) as { error: string }).error).toBe("INTERNAL_ERROR");
    }
    quiet.mockRestore();
  });
});
