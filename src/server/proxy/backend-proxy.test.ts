import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { proxyToBackend, MAX_BODY_BYTES } from "@/server/proxy/backend-proxy";
import { resetAcademyConfigCache } from "@/config/academy-config";

const ORIGIN = "http://127.0.0.1:3212";

function setApiEnv() {
  process.env.ACADEMY_MODE = "api";
  process.env.BACKEND_ORIGIN = ORIGIN;
  resetAcademyConfigCache();
}

function backendJson(body: unknown, init: { status?: number; setCookie?: string; requestId?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  if (init.setCookie) headers.append("set-cookie", init.setCookie);
  if (init.requestId) headers.set("x-request-id", init.requestId);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = { ACADEMY_MODE: process.env.ACADEMY_MODE, BACKEND_ORIGIN: process.env.BACKEND_ORIGIN };
  setApiEnv();
});

afterEach(() => {
  process.env.ACADEMY_MODE = originalEnv.ACADEMY_MODE;
  process.env.BACKEND_ORIGIN = originalEnv.BACKEND_ORIGIN;
  resetAcademyConfigCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("proxyToBackend — allow-list", () => {
  it("forwards login POST to the fixed Backend login path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: { id: 1 } }));
    vi.stubGlobal("fetch", fetchMock);
    const req = new Request("http://academy.test/api/backend/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.co", password: "x" }),
    });
    const res = await proxyToBackend(req, "login");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(`${ORIGIN}/api/auth/login`, expect.objectContaining({ method: "POST" }));
  });

  it("forwards session GET to /api/auth/me", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: null }));
    vi.stubGlobal("fetch", fetchMock);
    await proxyToBackend(new Request("http://academy.test/api/backend/auth/me"), "session");
    expect(fetchMock).toHaveBeenCalledWith(`${ORIGIN}/api/auth/me`, expect.objectContaining({ method: "GET" }));
  });

  it("forwards logout POST to /api/auth/logout", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await proxyToBackend(new Request("http://academy.test/x", { method: "POST" }), "logout");
    expect(fetchMock).toHaveBeenCalledWith(`${ORIGIN}/api/auth/logout`, expect.objectContaining({ method: "POST" }));
  });

  it("rejects an unsupported method (405) without calling Backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await proxyToBackend(new Request("http://academy.test/x", { method: "GET" }), "login");
    expect(res.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("proxyToBackend — SSRF resistance", () => {
  it("ignores the request URL/host and always targets the configured origin", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: null }));
    vi.stubGlobal("fetch", fetchMock);
    const req = new Request("http://academy.test/api/backend/auth/me", {
      headers: { host: "evil.example.com", "x-forwarded-host": "evil.example.com" },
    });
    await proxyToBackend(req, "session");
    const [target] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(target).toBe(`${ORIGIN}/api/auth/me`);
    expect(target).not.toContain("evil");
  });

  it("only forwards allow-listed request headers and strips hop-by-hop/host", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: null }));
    vi.stubGlobal("fetch", fetchMock);
    const req = new Request("http://academy.test/api/backend/auth/me", {
      headers: {
        cookie: "trading_platform_session=abc",
        "x-csrf-token": "csrf1",
        accept: "application/json",
        host: "academy.test",
        connection: "keep-alive",
        authorization: "Bearer leak",
        "x-secret": "leak",
      },
    });
    await proxyToBackend(req, "session");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("cookie")).toBe("trading_platform_session=abc");
    expect(headers.get("x-csrf-token")).toBe("csrf1");
    expect(headers.get("host")).toBeNull();
    expect(headers.get("connection")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-secret")).toBeNull();
  });
});

describe("proxyToBackend — response passthrough", () => {
  it("preserves Set-Cookie, Cache-Control and request id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        backendJson(
          { user: { id: 1 } },
          { setCookie: "trading_platform_session=abc; Path=/; HttpOnly; SameSite=Lax", requestId: "req-9" },
        ),
      ),
    );
    const res = await proxyToBackend(
      new Request("http://academy.test/api/backend/auth/login", { method: "POST", body: "{}" }),
      "login",
    );
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("trading_platform_session="))).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBe("req-9");
  });
});

describe("proxyToBackend — failures", () => {
  it("returns a normalized 502 on a network failure (no raw error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const res = await proxyToBackend(new Request("http://academy.test/api/backend/auth/me"), "session");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.category).toBe("BACKEND_UNAVAILABLE");
  });

  it("normalizes an abort/timeout to NETWORK_ERROR", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    const res = await proxyToBackend(new Request("http://academy.test/api/backend/auth/me"), "session");
    expect(res.status).toBe(502);
    expect((await res.json()).category).toBe("NETWORK_ERROR");
  });

  it("rejects an oversized body (413)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const big = "x".repeat(MAX_BODY_BYTES + 1);
    const res = await proxyToBackend(
      new Request("http://academy.test/api/backend/auth/login", { method: "POST", body: big }),
      "login",
    );
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed (500 CONFIGURATION_ERROR) in fixture mode", async () => {
    process.env.ACADEMY_MODE = "fixture";
    delete process.env.BACKEND_ORIGIN;
    resetAcademyConfigCache();
    const res = await proxyToBackend(new Request("http://academy.test/api/backend/auth/me"), "session");
    expect(res.status).toBe(500);
    expect((await res.json()).category).toBe("CONFIGURATION_ERROR");
  });

  it("never logs the request (no console output for a login proxy)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(backendJson({ user: { id: 1 } })));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await proxyToBackend(
      new Request("http://academy.test/api/backend/auth/login", {
        method: "POST",
        headers: { cookie: "trading_platform_session=secret" },
        body: JSON.stringify({ email: "a@b.co", password: "supersecret" }),
      }),
      "login",
    );
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });
});
