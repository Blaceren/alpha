/**
 * The bounded registration proxy (AFD-3A).
 *
 * Asserts the exact route matrix, the header boundary and the client-IP
 * integrity that the Backend's per-IP registration rate limit depends on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { proxyToBackend, MAX_BODY_BYTES } from "@/server/proxy/backend-proxy";
import { PROXY_ALLOW_LIST, PROXY_OPERATIONS } from "@/server/proxy/allow-list";
import { resetAcademyConfigCache } from "@/config/academy-config";

const ORIGIN = "http://127.0.0.1:3212";
const REGISTER_PATH = `${ORIGIN}/api/auth/register`;

function backendJson(body: unknown, init: { status?: number; setCookie?: string; requestId?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  if (init.setCookie) headers.append("set-cookie", init.setCookie);
  if (init.requestId) headers.set("x-request-id", init.requestId);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

function registerRequest(init: { headers?: Record<string, string>; body?: string; method?: string } = {}) {
  return new Request("http://academy.test/api/backend/auth/register", {
    method: init.method ?? "POST",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: init.method && init.method !== "POST" ? undefined : (init.body ?? JSON.stringify({ email: "a@b.co", password: "Passw0rd" })),
  });
}


/** The RequestInit the proxy handed to fetch. Fails loudly if it never called. */
function fetchInit(mock: ReturnType<typeof vi.fn>): RequestInit {
  const call = mock.mock.calls[0];
  if (!call) throw new Error("fetch was not called");
  return call[1] as RequestInit;
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

describe("register proxy — route matrix", () => {
  it("forwards POST to the fixed Backend registration path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: {} }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await proxyToBackend(registerRequest(), "register");

    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledWith(REGISTER_PATH, expect.objectContaining({ method: "POST" }));
  });

  it.each(["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])(
    "rejects %s with 405 before contacting Backend",
    async (method) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const res = await proxyToBackend(registerRequest({ method }), "register");

      expect(res.status).toBe(405);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("targets a constant path — never anything caller-supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({}, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyToBackend(
      new Request("http://academy.test/api/backend/auth/register?next=http://evil.example.com", {
        method: "POST",
        headers: { "content-type": "application/json", host: "evil.example.com", "x-forwarded-host": "evil.example.com" },
        body: JSON.stringify({ email: "a@b.co", password: "Passw0rd" }),
      }),
      "register",
    );

    // No SSRF: the caller's query, Host and X-Forwarded-Host cannot move the target.
    expect(fetchMock).toHaveBeenCalledWith(REGISTER_PATH, expect.anything());
  });

  it("exposes exactly one registration operation and no wildcard auth route", () => {
    expect(PROXY_ALLOW_LIST.register).toEqual({
      method: "POST",
      backendPath: "/api/auth/register",
      isLogin: false,
      hasBody: true,
      forwardClientIp: true,
      // AFD-3A3 — the Backend refuses a token whose action does not match this
      // surface, so the registration route must declare its own.
      authSurface: "academy_register",
    });
    // Adjacent Backend auth routes are not reachable: no operation names them.
    const paths = PROXY_OPERATIONS.map((op) => PROXY_ALLOW_LIST[op].backendPath);
    expect(paths).not.toContain("/api/auth/verify-email");
    expect(paths).not.toContain("/api/auth/resend-verification");
    expect(paths).not.toContain("/api/auth/session-status");
    expect(paths.filter((p) => p === "/api/auth/register")).toHaveLength(1);
    expect(paths.some((p) => p.includes("*"))).toBe(false);
  });
});

describe("register proxy — header boundary", () => {
  async function forwardedHeaders(requestHeaders: Record<string, string>): Promise<Headers> {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({}, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await proxyToBackend(registerRequest({ headers: requestHeaders }), "register");
    return new Headers(fetchInit(fetchMock).headers as Headers);
  }

  it("never forwards Authorization or the ingress Basic Auth credential", async () => {
    const headers = await forwardedHeaders({
      authorization: "Basic dGVhbTp0ZWFt",
      "proxy-authorization": "Basic dGVhbTp0ZWFt",
    });
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("proxy-authorization")).toBeNull();
  });

  it("drops host poisoning and every client-controlled IP header we do not re-derive", async () => {
    const headers = await forwardedHeaders({
      "x-forwarded-host": "evil.example.com",
      host: "evil.example.com",
      "cf-connecting-ip": "9.9.9.9",
      "true-client-ip": "9.9.9.9",
      forwarded: "for=9.9.9.9",
    });
    expect(headers.get("x-forwarded-host")).toBeNull();
    expect(headers.get("cf-connecting-ip")).toBeNull();
    expect(headers.get("true-client-ip")).toBeNull();
    expect(headers.get("forwarded")).toBeNull();
    expect(headers.get("host")).toBeNull();
  });

  it("forwards the ingress-stamped client IP under BOTH names Backend consults", async () => {
    // Backend's getRequestIp reads x-forwarded-for first and only then
    // x-real-ip, and Backend's own server injects x-forwarded-for=127.0.0.1
    // for a loopback hop. Sending only x-real-ip would be silently useless.
    const headers = await forwardedHeaders({ "x-real-ip": "203.0.113.7" });
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(headers.get("x-real-ip")).toBe("203.0.113.7");
  });

  it("REPLACES a spoofed X-Forwarded-For instead of appending to it", async () => {
    const headers = await forwardedHeaders({
      "x-forwarded-for": "9.9.9.9, 203.0.113.7",
      "x-real-ip": "203.0.113.7",
    });
    // Exactly one element, and it is the ingress-measured address. The forged
    // head is gone, so it can never become the key Backend rate-limits on.
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(headers.get("x-forwarded-for")).not.toContain("9.9.9.9");
  });

  it("forwards no IP at all when the value is malformed (fails safe, never invents)", async () => {
    const headers = await forwardedHeaders({ "x-real-ip": "not-an-ip" });
    expect(headers.get("x-real-ip")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
  });

  it("never lets a browser-supplied chain through when there is no trusted value", async () => {
    const headers = await forwardedHeaders({ "x-forwarded-for": "9.9.9.9" });
    expect(headers.get("x-forwarded-for")).toBeNull();
  });

  it("does not attach a client IP to operations that do not rate-limit on it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: null }));
    vi.stubGlobal("fetch", fetchMock);
    await proxyToBackend(
      new Request("http://academy.test/api/backend/auth/me", { headers: { "x-real-ip": "203.0.113.7" } }),
      "session",
    );
    const headers = new Headers(fetchInit(fetchMock).headers as Headers);
    expect(headers.get("x-real-ip")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
  });
});

describe("register proxy — bounds and response handling", () => {
  it("rejects an oversized body with 413 before contacting Backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await proxyToBackend(
      registerRequest({ body: "x".repeat(MAX_BODY_BYTES + 1) }),
      "register",
    );

    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bounds the upstream wait with an abort signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({}, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await proxyToBackend(registerRequest(), "register");
    expect(fetchInit(fetchMock).signal).toBeInstanceOf(AbortSignal);
  });

  it("maps an upstream timeout to 502 without leaking the cause", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));

    const res = await proxyToBackend(registerRequest(), "register");
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.category).toBe("NETWORK_ERROR");
    expect(JSON.stringify(body)).not.toContain("aborted");
  });

  it("maps an unreachable Backend to 502", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const res = await proxyToBackend(registerRequest(), "register");
    expect(res.status).toBe(502);
    expect((await res.json()).category).toBe("BACKEND_UNAVAILABLE");
  });

  it("preserves the Backend session cookie exactly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        backendJson({ user: {} }, { status: 201, setCookie: "trading_platform_session=t; HttpOnly; Path=/" }),
      ),
    );
    const res = await proxyToBackend(registerRequest(), "register");
    expect(res.headers.get("set-cookie")).toContain("trading_platform_session=t");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("preserves stable Backend error status and code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(backendJson({ error: "RATE_LIMITED", message: "…" }, { status: 429 })),
    );
    const res = await proxyToBackend(registerRequest(), "register");
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("RATE_LIMITED");
  });

  it("never caches a registration response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: {} }), { status: 201, headers: { "content-type": "application/json" } }),
    ));
    const res = await proxyToBackend(registerRequest(), "register");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed when the Academy is not configured for Backend calls", async () => {
    process.env.ACADEMY_MODE = "fixture";
    resetAcademyConfigCache();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await proxyToBackend(registerRequest(), "register");

    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// AFD-3A2 — the Turnstile token crosses the proxy in the body, and only there.
// ===========================================================================

describe("register proxy — CAPTCHA token boundary", () => {
  const TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

  it("forwards the token in the JSON body and puts it in no header or URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: {} }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyToBackend(
      registerRequest({
        body: JSON.stringify({ email: "a@b.co", password: "Passw0rd", captchaToken: TOKEN }),
      }),
      "register",
    );

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch was not called");
    const [url, init] = call as [string, RequestInit];

    expect(url).toBe(REGISTER_PATH);
    // A token in a URL would land in access logs, in `Referer`, and in browser
    // history — all places a single-use credential must never reach.
    expect(url).not.toContain(TOKEN);
    // The proxy forwards the body as a byte buffer, so decode it rather than
    // stringifying the object.
    const body = init.body as ArrayBuffer;
    expect(new TextDecoder().decode(body)).toContain(TOKEN);

    const headers = new Headers(init.headers);
    for (const [, value] of headers.entries()) {
      expect(value).not.toContain(TOKEN);
    }
  });

  it("does not log the token", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: {} }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyToBackend(
      registerRequest({
        body: JSON.stringify({ email: "a@b.co", password: "Passw0rd", captchaToken: TOKEN }),
      }),
      "register",
    );

    for (const spy of [log, error, warn]) {
      expect(spy.mock.calls.flat().map(String).join(" ")).not.toContain(TOKEN);
    }
  });

  it.each([
    [503, "CAPTCHA_UNAVAILABLE"],
    [503, "CAPTCHA_CONFIGURATION_ERROR"],
    [400, "CAPTCHA_FAILED"],
  ])("relays a %s %s envelope unchanged", async (status, code) => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ error: code }, { status }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await proxyToBackend(registerRequest(), "register");

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code });
  });

  it("still forwards the trusted client IP alongside a token (AFD-3A regression)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: {} }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyToBackend(
      registerRequest({
        headers: { "x-real-ip": "203.0.113.9", "x-forwarded-for": "10.0.0.1, 192.168.1.1" },
        body: JSON.stringify({ email: "a@b.co", password: "Passw0rd", captchaToken: TOKEN }),
      }),
      "register",
    );

    const headers = new Headers(fetchInit(fetchMock).headers);
    // Backend rate-limits registration per resolved IP and hands that same IP
    // to Siteverify as `remoteip`. Adding CAPTCHA must not have moved it.
    expect(headers.get("x-real-ip")).toBe("203.0.113.9");
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.9");
  });

  it("forwards no Authorization header even when the browser sends one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ user: {} }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyToBackend(
      registerRequest({
        headers: { authorization: "Basic c3B5Om11c3Q=" },
        body: JSON.stringify({ email: "a@b.co", password: "Passw0rd", captchaToken: TOKEN }),
      }),
      "register",
    );

    const headers = new Headers(fetchInit(fetchMock).headers);
    expect(headers.get("authorization")).toBeNull();
  });
});
