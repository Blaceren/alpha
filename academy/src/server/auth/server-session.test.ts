/**
 * SIGNED OUT IS AN ANSWER; AN UNREACHABLE BACKEND IS NOT (2026-10-04).
 *
 * The guard used to read both as «no viewer» and send the learner to /login.
 * A ten-second hiccup on the Backend then signed everyone out of every page.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const cookieGet = vi.fn();
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: cookieGet })) }));
vi.mock("@/config/academy-config", () => ({
  getAcademyConfig: () => ({ mode: "api", backendOrigin: "https://backend.invalid", requestTimeoutMs: 1000 }),
}));

import { readServerSession, getServerViewer } from "@/server/auth/server-session";

const user = { id: 7, email: "learner@example.invalid", name: "Анна", role: "user", status: "active" };

function backend(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response));
}

beforeEach(() => {
  cookieGet.mockReset();
  cookieGet.mockImplementation((name: string) => (name.includes("trading_platform_session") ? { value: "session-token" } : undefined));
});

describe("readServerSession", () => {
  it("reads a viewer", async () => {
    backend(200, { user });
    const read = await readServerSession();
    expect(read.kind).toBe("viewer");
    expect((await getServerViewer())?.name).toBe("Анна");
  });

  it("is signed out when the Backend says there is no session, or that it may not be used", async () => {
    backend(200, { user: null });
    expect((await readServerSession()).kind).toBe("signed-out");
    backend(401, { error: "UNAUTHORIZED" });
    expect((await readServerSession()).kind).toBe("signed-out");
    backend(403, { error: "FORBIDDEN" });
    expect((await readServerSession()).kind).toBe("signed-out");
  });

  it("is signed out without a cookie, and asks nothing", async () => {
    cookieGet.mockReturnValue(undefined);
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect((await readServerSession()).kind).toBe("signed-out");
    expect(f).not.toHaveBeenCalled();
  });

  it("is UNAVAILABLE — not signed out — when the Backend fails, times out or answers nonsense", async () => {
    backend(500, { error: "INTERNAL" });
    expect((await readServerSession()).kind).toBe("unavailable");
    backend(502, null);
    expect((await readServerSession()).kind).toBe("unavailable");
    backend(429, { error: "RATE_LIMITED" });
    expect((await readServerSession()).kind).toBe("unavailable");
    backend(200, { unexpected: true });
    expect((await readServerSession()).kind).toBe("unavailable");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("aborted"); }));
    expect((await readServerSession()).kind).toBe("unavailable");
    // …and the viewer-only reading still claims nobody.
    expect(await getServerViewer()).toBeNull();
  });
});
