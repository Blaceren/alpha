/**
 * Boundary tests for the sessions proxy (DD-354, owner 2026-10-07: two live
 * sessions per account, listed in the profile, the other one closable).
 *
 * A list and one write. The write takes one caller-supplied id, so these pin
 * what keeps it narrow: the method, the id's shape before any Backend request
 * is built, the constant path template, and the headers that go along.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { proxyCloseSession, proxyListSessions } from "@/server/proxy/sessions-proxy";
import { proxyToBackend } from "@/server/proxy/backend-proxy";
import { resetAcademyConfigCache } from "@/config/academy-config";

const ORIGIN = "http://127.0.0.1:3100";
const ID = "cmotherdevice00000000000002";

let fetchMock: ReturnType<typeof vi.fn>;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = { ACADEMY_MODE: process.env.ACADEMY_MODE, BACKEND_ORIGIN: process.env.BACKEND_ORIGIN };
  process.env.ACADEMY_MODE = "api";
  process.env.BACKEND_ORIGIN = ORIGIN;
  resetAcademyConfigCache();
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ limit: 2, sessions: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetAcademyConfigCache();
  vi.unstubAllGlobals();
});

const sentTo = () => fetchMock.mock.calls[0]![0] as string;
const sentInit = () => fetchMock.mock.calls[0]![1] as RequestInit & { headers: Headers };

describe("sessions proxy — the list", () => {
  it("is a GET to one constant Backend path, with the cookie and nothing to write with", async () => {
    const request = new Request("http://academy.test/api/backend/auth/sessions", {
      headers: { cookie: "a=b", "x-csrf-token": "t", "user-agent": "Mozilla/5.0 Chrome/129", "x-forwarded-for": "1.2.3.4" },
    });
    const response = await proxyListSessions(request);
    expect(response.status).toBe(200);
    expect(sentTo()).toBe(`${ORIGIN}/api/auth/sessions`);
    expect(sentInit().method).toBe("GET");
    const headers = sentInit().headers;
    expect(headers.get("cookie")).toBe("a=b");
    for (const dropped of ["x-csrf-token", "user-agent", "x-forwarded-for"]) expect(headers.get(dropped)).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses any other method before reaching the Backend", async () => {
    const response = await proxyListSessions(new Request("http://academy.test/api/backend/auth/sessions", { method: "POST" }));
    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sessions proxy — closing one", () => {
  const post = (headers: Record<string, string> = {}) =>
    new Request(`http://academy.test/api/backend/auth/sessions/${ID}/close`, { method: "POST", headers });

  it("is a DELETE of that session at the Backend, with the CSRF pair", async () => {
    await proxyCloseSession(post({ cookie: "a=b", "x-csrf-token": "t" }), ID);
    expect(sentTo()).toBe(`${ORIGIN}/api/auth/sessions/${ID}`);
    expect(sentInit().method).toBe("DELETE");
    expect(sentInit().headers.get("x-csrf-token")).toBe("t");
    expect(sentInit().headers.get("cookie")).toBe("a=b");
  });

  it("refuses an id that is not a session's before any request is built", async () => {
    for (const bad of ["", "abc", "../../admin", `${ID}/x`, `${ID}?a=1`, "C".repeat(25), "x".repeat(41), "%2e%2e"]) {
      const response = await proxyCloseSession(post(), bad);
      expect(response.status, bad).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses any method but POST", async () => {
    const response = await proxyCloseSession(
      new Request(`http://academy.test/api/backend/auth/sessions/${ID}/close`, { method: "GET" }),
      ID,
    );
    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the browser's own description goes along only where a session is issued", () => {
  const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile/15E148 Safari/604.1";
  const authRequest = (path: string, method = "POST") =>
    new Request(`http://academy.test/api/backend/auth/${path}`, {
      method,
      headers: { "content-type": "application/json", "user-agent": UA },
      body: method === "POST" ? JSON.stringify({}) : undefined,
    });

  it("on login, registration and a password change", async () => {
    for (const [operation, path] of [
      ["login", "login"],
      ["register", "register"],
      ["changePassword", "change-password"],
    ] as const) {
      fetchMock.mockClear();
      await proxyToBackend(authRequest(path), operation);
      const headers = (fetchMock.mock.calls[0]![1] as RequestInit & { headers: Headers }).headers;
      expect(headers.get("user-agent"), operation).toBe(UA);
    }
  });

  it("and nowhere else", async () => {
    for (const [operation, path, method] of [
      ["logout", "logout", "POST"],
      ["session", "me", "GET"],
      ["csrf", "csrf", "GET"],
    ] as const) {
      fetchMock.mockClear();
      await proxyToBackend(authRequest(path, method), operation);
      const headers = (fetchMock.mock.calls[0]![1] as RequestInit & { headers: Headers }).headers;
      expect(headers.get("user-agent"), operation).toBeNull();
    }
  });
});
