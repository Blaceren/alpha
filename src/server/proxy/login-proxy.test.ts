/**
 * The bounded LOGIN proxy (AFD-3A3).
 *
 * AFD-3A gave the registration operation a trusted client IP and a strict header
 * boundary; `login` was left as it was. This suite asserts the two properties it
 * gained, and re-asserts the boundary for the login route specifically:
 *
 *   - the Backend receives the ingress-measured client IP, so login attempts do
 *     not all share one rate-limit bucket;
 *   - the Backend is told this is `academy_login` and cannot be told otherwise
 *     by the browser;
 *   - nothing the browser sends about forwarding, authorization or the host
 *     survives the hop.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { proxyToBackend, MAX_BODY_BYTES } from "@/server/proxy/backend-proxy";
import { PROXY_ALLOW_LIST, PROXY_OPERATIONS } from "@/server/proxy/allow-list";
import { BACKEND_AUTH_SURFACE_HEADER } from "@/server/proxy/auth-surface";
import { UNTRUSTED_FORWARDING_HEADERS } from "@/server/proxy/client-ip";
import { resetAcademyConfigCache } from "@/config/academy-config";

const ORIGIN = "http://127.0.0.1:3213";
const LOGIN_PATH = `${ORIGIN}/api/auth/login`;

function backendJson(body: unknown, init: { status?: number; setCookie?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  if (init.setCookie) headers.append("set-cookie", init.setCookie);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

function loginRequest(init: { headers?: Record<string, string>; body?: string; method?: string } = {}) {
  const method = init.method ?? "POST";
  return new Request("http://academy.test/api/backend/auth/login", {
    method,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body:
      method !== "POST"
        ? undefined
        : (init.body ?? JSON.stringify({ email: "a@b.co", password: "Passw0rd", captchaToken: "t" })),
  });
}

/** The headers the proxy handed to fetch. Fails loudly if it never called. */
function sentHeaders(mock: ReturnType<typeof vi.fn>): Headers {
  const call = mock.mock.calls[0];
  if (!call) throw new Error("fetch was not called");
  return (call[1] as RequestInit).headers as Headers;
}

let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = { ACADEMY_MODE: process.env.ACADEMY_MODE, BACKEND_ORIGIN: process.env.BACKEND_ORIGIN };
  process.env.ACADEMY_MODE = "api";
  process.env.BACKEND_ORIGIN = ORIGIN;
  resetAcademyConfigCache();
});

afterEach(() => {
  process.env.ACADEMY_MODE = originalEnv.ACADEMY_MODE;
  process.env.BACKEND_ORIGIN = originalEnv.BACKEND_ORIGIN;
  resetAcademyConfigCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("login proxy — route matrix", () => {
  it("forwards POST to the fixed Backend login path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: {} }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await proxyToBackend(loginRequest(), "login");

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(LOGIN_PATH, expect.objectContaining({ method: "POST" }));
  });

  it.each(["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])(
    "rejects %s with 405 before contacting Backend",
    async (method) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const res = await proxyToBackend(loginRequest({ method }), "login");

      expect(res.status).toBe(405);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("refuses an oversized body before contacting Backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await proxyToBackend(
      loginRequest({ body: "x".repeat(MAX_BODY_BYTES + 1) }),
      "login",
    );

    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still exposes no operation beyond the five named ones", () => {
    expect([...PROXY_OPERATIONS].sort()).toEqual(
      ["csrf", "login", "logout", "register", "session"].sort(),
    );
    // Every Backend path is a constant, so no caller input can steer one.
    for (const route of Object.values(PROXY_ALLOW_LIST)) {
      expect(route.backendPath.startsWith("/api/")).toBe(true);
      expect(route.backendPath).not.toContain("*");
      expect(route.backendPath).not.toContain(":");
    }
  });
});

describe("login proxy — the authentication surface", () => {
  it("tells the Backend this is the Academy login surface", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyToBackend(loginRequest(), "login");

    expect(sentHeaders(fetchMock).get(BACKEND_AUTH_SURFACE_HEADER)).toBe("academy_login");
  });

  it("overwrites a browser-supplied surface rather than trusting it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: {} }));
    vi.stubGlobal("fetch", fetchMock);

    // The attack this prevents: hold a token minted on some other surface,
    // declare that surface here, and have the Backend apply the wrong pin.
    await proxyToBackend(
      loginRequest({ headers: { [BACKEND_AUTH_SURFACE_HEADER]: "crm_login" } }),
      "login",
    );

    expect(sentHeaders(fetchMock).get(BACKEND_AUTH_SURFACE_HEADER)).toBe("academy_login");
  });

  it("declares the registration surface on the registration route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: {} }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyToBackend(
      new Request("http://academy.test/api/backend/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.co", password: "Passw0rd" }),
      }),
      "register",
    );

    expect(sentHeaders(fetchMock).get(BACKEND_AUTH_SURFACE_HEADER)).toBe("academy_register");
  });

  it("sends no surface on operations that raise no challenge", async () => {
    for (const operation of ["session", "logout", "csrf"] as const) {
      const fetchMock = vi.fn().mockResolvedValue(backendJson({}));
      vi.stubGlobal("fetch", fetchMock);

      const route = PROXY_ALLOW_LIST[operation];
      await proxyToBackend(
        new Request("http://academy.test/x", { method: route.method }),
        operation,
      );

      expect(sentHeaders(fetchMock).get(BACKEND_AUTH_SURFACE_HEADER)).toBeNull();
    }
  });
});

describe("login proxy — client IP integrity", () => {
  it("forwards the ingress-measured address under both header names", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyToBackend(loginRequest({ headers: { "x-real-ip": "203.0.113.7" } }), "login");

    const headers = sentHeaders(fetchMock);
    // Backend's `getRequestIp` reads x-forwarded-for FIRST and its own Node
    // server injects 127.0.0.1 for a loopback hop, so setting only x-real-ip
    // would silently collapse every login into one bucket.
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(headers.get("x-real-ip")).toBe("203.0.113.7");
  });

  it("ignores a browser-supplied X-Forwarded-For entirely", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyToBackend(
      loginRequest({
        headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8", "x-real-ip": "203.0.113.7" },
      }),
      "login",
    );

    // A spoofed chain must neither set nor shift the value: nginx APPENDS to
    // X-Forwarded-For, so its first element is attacker-controlled and Backend
    // reads exactly that element.
    expect(sentHeaders(fetchMock).get("x-forwarded-for")).toBe("203.0.113.7");
  });

  it("forwards nothing when no trustworthy address is available", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyToBackend(loginRequest({ headers: { "x-forwarded-for": "9.9.9.9" } }), "login");

    // More restrictive, never less: Backend falls back to the loopback address.
    expect(sentHeaders(fetchMock).get("x-forwarded-for")).toBeNull();
    expect(sentHeaders(fetchMock).get("x-real-ip")).toBeNull();
  });

  it.each(["not-an-ip", "203.0.113.7, 1.1.1.1", "", "   ", "999.1.1.1", "01.2.3.4"])(
    "refuses to forward a malformed x-real-ip (%s)",
    async (value) => {
      const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: {} }));
      vi.stubGlobal("fetch", fetchMock);

      await proxyToBackend(loginRequest({ headers: { "x-real-ip": value } }), "login");

      expect(sentHeaders(fetchMock).get("x-forwarded-for")).toBeNull();
    },
  );

  it("keeps two distinct clients in two distinct buckets", async () => {
    const seen: Array<string | null> = [];
    for (const ip of ["203.0.113.7", "198.51.100.42"]) {
      const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: {} }));
      vi.stubGlobal("fetch", fetchMock);
      await proxyToBackend(loginRequest({ headers: { "x-real-ip": ip } }), "login");
      seen.push(sentHeaders(fetchMock).get("x-forwarded-for"));
    }
    expect(seen).toEqual(["203.0.113.7", "198.51.100.42"]);
  });
});

describe("login proxy — the header boundary", () => {
  it("drops every client-controlled forwarding header the browser sends", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: {} }));
    vi.stubGlobal("fetch", fetchMock);

    const hostile: Record<string, string> = {};
    for (const header of UNTRUSTED_FORWARDING_HEADERS) hostile[header] = "6.6.6.6";
    await proxyToBackend(loginRequest({ headers: hostile }), "login");

    const headers = sentHeaders(fetchMock);
    for (const header of UNTRUSTED_FORWARDING_HEADERS) {
      // x-forwarded-for is the one name the proxy WRITES, and only from a
      // trusted x-real-ip — absent here, so nothing must survive.
      expect(headers.get(header)).toBeNull();
    }
  });

  it("never forwards an Authorization or ingress Basic-Auth header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyToBackend(
      loginRequest({
        headers: {
          authorization: "Basic YWRtaW46YWRtaW4=",
          "proxy-authorization": "Basic YWRtaW46YWRtaW4=",
          "x-forwarded-user": "admin",
        },
      }),
      "login",
    );

    const headers = sentHeaders(fetchMock);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("proxy-authorization")).toBeNull();
    expect(headers.get("x-forwarded-user")).toBeNull();
  });

  it("never forwards a client-supplied Host or X-Forwarded-Host", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyToBackend(
      loginRequest({ headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "http" } }),
      "login",
    );

    const headers = sentHeaders(fetchMock);
    expect(headers.get("x-forwarded-host")).toBeNull();
    expect(headers.get("x-forwarded-proto")).toBeNull();
  });

  it("preserves Set-Cookie and refuses to cache the response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(backendJson({ user: {} }, { setCookie: "trading_platform_session=abc; HttpOnly; Path=/" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await proxyToBackend(loginRequest(), "login");

    const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    expect(cookies.some((cookie) => cookie.includes("trading_platform_session=abc"))).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("passes the CAPTCHA failure status and code through untouched", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(backendJson({ error: "CAPTCHA_FAILED", message: "…" }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await proxyToBackend(loginRequest(), "login");

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "CAPTCHA_FAILED" });
  });
});
