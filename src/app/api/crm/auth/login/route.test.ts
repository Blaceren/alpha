/**
 * The CRM login route (AFD-3A3).
 *
 * The route already carried the staff decision — authenticate at the backend,
 * then refuse to bridge a session cookie to a non-staff account. This suite adds
 * the three properties the Turnstile work depends on, and re-asserts the ones it
 * must not have disturbed:
 *
 *   - the solved token is forwarded, in the body and nowhere else;
 *   - the backend is told this is `crm_login`, from a constant, and a browser
 *     cannot say otherwise;
 *   - the ingress-measured client IP reaches the backend, so staff logins do not
 *     share one rate-limit bucket;
 *   - CAPTCHA outcomes map to their own codes rather than to "wrong password";
 *   - the staff check, the cookie bridge and the absence of enumeration are
 *     exactly as they were.
 *
 * No credential appears here: passwords are synthetic strings and the session
 * cookie value is a placeholder.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import { BACKEND_AUTH_SURFACE_HEADER } from "@/server/backend-client";
import { UNTRUSTED_FORWARDING_HEADERS } from "@/server/client-ip";
import { SESSION_COOKIE_NAME } from "@/server/set-cookie-bridge";

const ORIGIN = "http://127.0.0.1:3399";
const SESSION_COOKIE = `${SESSION_COOKIE_NAME}=synthetic-session-value; Path=/; HttpOnly`;

let originalOrigin: string | undefined;

beforeEach(() => {
  originalOrigin = process.env.CRM_BACKEND_ORIGIN;
  process.env.CRM_BACKEND_ORIGIN = ORIGIN;
});

afterEach(() => {
  process.env.CRM_BACKEND_ORIGIN = originalOrigin;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function loginRequest(
  body: Record<string, unknown> = { email: "staff@example.com", password: "secret123" },
  headers: Record<string, string> = {},
) {
  return new Request("http://crm.test/api/crm/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function backendResponse(
  body: unknown,
  init: { status?: number; setCookie?: string } = {},
): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.setCookie) headers.append("set-cookie", init.setCookie);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

/**
 * A fetch double that answers the login call, then the staff-session check.
 * Records every call so the outbound contract can be asserted.
 */
function backendDouble(
  login: Response | (() => Response),
  session: Response | (() => Response) = () => backendResponse({ staffRole: "crm_admin" }),
) {
  const calls: RecordedCall[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const responder = calls.length === 1 ? login : session;
    return typeof responder === "function" ? responder() : responder.clone();
  });
  vi.stubGlobal("fetch", impl);
  return { calls, impl };
}

type RecordedCall = { url: string; init: RequestInit };

/** The Nth recorded call. Fails loudly rather than yielding `undefined`. */
function callAt(calls: RecordedCall[], index = 0): RecordedCall {
  const call = calls[index];
  if (!call) throw new Error(`the backend was not called ${index + 1} time(s)`);
  return call;
}

function headersOf(call: RecordedCall): Record<string, string> {
  return call.init.headers as Record<string, string>;
}

function bodyOf(call: RecordedCall): Record<string, unknown> {
  return JSON.parse(call.init.body as string) as Record<string, unknown>;
}

describe("CRM login route — the Turnstile token", () => {
  it("forwards the solved token to the backend, in the body only", async () => {
    const { calls } = backendDouble(() =>
      backendResponse({ user: {} }, { setCookie: SESSION_COOKIE }),
    );

    const res = await POST(
      loginRequest({ email: "staff@example.com", password: "secret123", captchaToken: "tok-1" }),
    );

    expect(res.status).toBe(200);
    expect(bodyOf(callAt(calls))).toEqual({
      email: "staff@example.com",
      password: "secret123",
      captchaToken: "tok-1",
    });
    // Never a header, never a query parameter — either would end up in an
    // access log or a Referer somewhere between here and the backend.
    expect(callAt(calls).url).not.toContain("tok-1");
    expect(JSON.stringify(headersOf(callAt(calls)))).not.toContain("tok-1");
  });

  it("omits the field entirely when no token was supplied", async () => {
    const { calls } = backendDouble(() =>
      backendResponse({ error: "CAPTCHA_FAILED" }, { status: 400 }),
    );

    await POST(loginRequest());

    // An absent token is a REFUSAL at the backend, not a bypass — the route
    // must not invent one, and must not send `captchaToken: undefined` either.
    expect("captchaToken" in bodyOf(callAt(calls))).toBe(false);
  });

  it("rejects a body carrying an unexpected field before contacting the backend", async () => {
    const { impl } = backendDouble(() => backendResponse({ user: {} }));

    const res = await POST(
      loginRequest({
        email: "staff@example.com",
        password: "secret123",
        // `.strict()` — a client-supplied role, surface or actor never travels.
        surface: "academy_login",
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "invalid_input" });
    expect(impl).not.toHaveBeenCalled();
  });

  it("rejects an absurdly large token locally", async () => {
    const { impl } = backendDouble(() => backendResponse({ user: {} }));

    const res = await POST(
      loginRequest({
        email: "staff@example.com",
        password: "secret123",
        captchaToken: "x".repeat(4097),
      }),
    );

    expect(res.status).toBe(400);
    expect(impl).not.toHaveBeenCalled();
  });
});

describe("CRM login route — the authentication surface", () => {
  it("declares crm_login to the backend", async () => {
    const { calls } = backendDouble(() =>
      backendResponse({ user: {} }, { setCookie: SESSION_COOKIE }),
    );

    await POST(loginRequest());

    expect(headersOf(callAt(calls))[BACKEND_AUTH_SURFACE_HEADER]).toBe("crm_login");
  });

  it("cannot be told otherwise by the browser", async () => {
    const { calls } = backendDouble(() =>
      backendResponse({ user: {} }, { setCookie: SESSION_COOKIE }),
    );

    // The attack: hold an `academy_login` token, declare that surface here, and
    // have the backend apply the wrong action pin. The outbound headers are
    // built from scratch, so the incoming one is not even read.
    await POST(loginRequest(undefined, { [BACKEND_AUTH_SURFACE_HEADER]: "academy_login" }));

    expect(headersOf(callAt(calls))[BACKEND_AUTH_SURFACE_HEADER]).toBe("crm_login");
  });
});

describe("CRM login route — client IP integrity", () => {
  it("forwards the ingress-measured address under both header names", async () => {
    const { calls } = backendDouble(() =>
      backendResponse({ user: {} }, { setCookie: SESSION_COOKIE }),
    );

    await POST(loginRequest(undefined, { "x-real-ip": "203.0.113.7" }));

    const headers = headersOf(callAt(calls));
    expect(headers["x-forwarded-for"]).toBe("203.0.113.7");
    expect(headers["x-real-ip"]).toBe("203.0.113.7");
  });

  it("ignores a browser-supplied forwarding chain entirely", async () => {
    const { calls } = backendDouble(() =>
      backendResponse({ user: {} }, { setCookie: SESSION_COOKIE }),
    );

    const hostile: Record<string, string> = { "x-real-ip": "203.0.113.7" };
    for (const header of UNTRUSTED_FORWARDING_HEADERS) hostile[header] = "6.6.6.6";
    await POST(loginRequest(undefined, hostile));

    const headers = headersOf(callAt(calls));
    // nginx APPENDS to X-Forwarded-For, so its first element is attacker
    // controlled — and the backend reads exactly that element.
    expect(headers["x-forwarded-for"]).toBe("203.0.113.7");
    for (const header of ["forwarded", "x-client-ip", "cf-connecting-ip", "true-client-ip"]) {
      expect(headers[header]).toBeUndefined();
    }
  });

  it("forwards nothing when no trustworthy address is available", async () => {
    const { calls } = backendDouble(() =>
      backendResponse({ user: {} }, { setCookie: SESSION_COOKIE }),
    );

    await POST(loginRequest(undefined, { "x-forwarded-for": "9.9.9.9" }));

    const headers = headersOf(callAt(calls));
    expect(headers["x-forwarded-for"]).toBeUndefined();
    expect(headers["x-real-ip"]).toBeUndefined();
  });

  it("keeps two distinct clients in two distinct buckets", async () => {
    const seen: Array<string | undefined> = [];
    for (const ip of ["203.0.113.7", "198.51.100.42"]) {
      const { calls } = backendDouble(() =>
        backendResponse({ user: {} }, { setCookie: SESSION_COOKIE }),
      );
      await POST(loginRequest(undefined, { "x-real-ip": ip }));
      seen.push(headersOf(callAt(calls))["x-forwarded-for"]);
      vi.unstubAllGlobals();
    }
    expect(seen).toEqual(["203.0.113.7", "198.51.100.42"]);
  });

  it("never forwards an Authorization or ingress Basic-Auth header", async () => {
    const { calls } = backendDouble(() =>
      backendResponse({ user: {} }, { setCookie: SESSION_COOKIE }),
    );

    await POST(
      loginRequest(undefined, {
        authorization: "Basic c3ludGhldGljOnZhbHVl",
        "proxy-authorization": "Basic c3ludGhldGljOnZhbHVl",
        cookie: "unrelated=1",
      }),
    );

    const headers = headersOf(callAt(calls));
    expect(headers.authorization).toBeUndefined();
    expect(headers.Authorization).toBeUndefined();
    expect(headers["proxy-authorization"]).toBeUndefined();
    // The route sends no cookie on the login call either — there is no session
    // to present yet, and forwarding one would be ambient authority.
    expect(headers.Cookie).toBeUndefined();
  });
});

describe("CRM login route — the CAPTCHA error contract", () => {
  it.each([
    ["CAPTCHA_FAILED", 400, "captcha_failed"],
    ["CAPTCHA_UNAVAILABLE", 503, "captcha_unavailable"],
    ["CAPTCHA_CONFIGURATION_ERROR", 503, "captcha_configuration_error"],
  ])("maps backend %s onto its own CRM code", async (backendCode, status, crmCode) => {
    backendDouble(() => backendResponse({ error: backendCode, message: "…" }, { status }));

    const res = await POST(loginRequest());

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ code: crmCode });
  });

  it("does not report a failed challenge as a wrong password", async () => {
    backendDouble(() => backendResponse({ error: "CAPTCHA_FAILED" }, { status: 400 }));

    const res = await POST(loginRequest());
    const body = (await res.json()) as { code: string };

    expect(body.code).not.toBe("invalid_credentials");
    expect(body.code).not.toBe("invalid_input");
  });

  it("leaves the pre-existing status mapping untouched", async () => {
    const cases: Array<[number, unknown, string]> = [
      [401, { error: "…" }, "invalid_credentials"],
      [403, { error: "ACCOUNT_BLOCKED" }, "inactive"],
      [403, { error: "EMAIL_NOT_VERIFIED" }, "email_not_verified"],
      [429, {}, "rate_limited"],
      [500, {}, "upstream_unavailable"],
    ];
    for (const [status, body, code] of cases) {
      backendDouble(() => backendResponse(body, { status }));
      const res = await POST(loginRequest());
      expect(await res.json()).toMatchObject({ code });
      vi.unstubAllGlobals();
    }
  });
});

describe("CRM login route — the staff contract, unchanged", () => {
  it("bridges the session cookie for a confirmed staff account", async () => {
    backendDouble(
      () => backendResponse({ user: {} }, { setCookie: SESSION_COOKIE }),
      () => backendResponse({ staffRole: "crm_admin" }),
    );

    const res = await POST(loginRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    expect(cookies.some((cookie) => cookie.includes(SESSION_COOKIE_NAME))).toBe(true);
  });

  it("refuses to bridge a cookie for an authenticated NON-staff account", async () => {
    backendDouble(
      () => backendResponse({ user: {} }, { setCookie: SESSION_COOKIE }),
      () => backendResponse({ error: "forbidden" }, { status: 403 }),
    );

    const res = await POST(loginRequest());

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "not_staff" });
    const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    expect(cookies.some((cookie) => cookie.includes(SESSION_COOKIE_NAME))).toBe(false);
  });

  it("checks staff status only AFTER a successful authentication", async () => {
    const { impl } = backendDouble(() => backendResponse({ error: "…" }, { status: 401 }));

    await POST(loginRequest());

    // One call. A rejected credential must not cost a second backend request.
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("never returns the backend user payload", async () => {
    backendDouble(() =>
      backendResponse(
        { user: { email: "staff@example.com", level: 3, xp: 120 } },
        { setCookie: SESSION_COOKIE },
      ),
    );

    const res = await POST(loginRequest());
    const text = await res.text();

    expect(text).toBe(JSON.stringify({ ok: true }));
    expect(text).not.toContain("staff@example.com");
    expect(text).not.toContain("xp");
  });

  it("never caches a login response", async () => {
    backendDouble(() => backendResponse({ user: {} }, { setCookie: SESSION_COOKIE }));
    const res = await POST(loginRequest());
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers a misconfigured origin without leaking it", async () => {
    process.env.CRM_BACKEND_ORIGIN = "";
    const { impl } = backendDouble(() => backendResponse({ user: {} }));

    const res = await POST(loginRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "server_error" });
    expect(impl).not.toHaveBeenCalled();
  });
});
