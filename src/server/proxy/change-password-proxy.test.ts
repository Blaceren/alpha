import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { proxyToBackend } from "@/server/proxy/backend-proxy";
import { PROXY_ALLOW_LIST } from "@/server/proxy/allow-list";
import { resetAcademyConfigCache } from "@/config/academy-config";

/**
 * THE ROTATED SESSION HAS TO SURVIVE THE HOP.
 *
 * Changing a password rotates the session: the Backend revokes the token the
 * browser arrived with and issues a new one in the same commit, then returns it
 * as a `Set-Cookie`. Everything about that is correct on the Backend and
 * completely useless if the Academy proxy drops the header — the person would
 * be signed out at the exact moment they proved who they were, and the failure
 * would look like a bug in authentication rather than in a header allow-list.
 *
 * So this asserts the header crosses INTACT: the same name, the same value, and
 * every attribute the Backend set — `__Host-` prefix, `HttpOnly`, `Secure`,
 * `SameSite`, `Path=/` and `Max-Age`. Not "a cookie was set"; the same cookie.
 */

const ORIGIN = "http://127.0.0.1:3213";

/* The exact shape `sessionCookieOptions` produces on the Backend. */
const ROTATED =
  "__Host-trading_platform_session=rotated-token-value; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800";

function backendResponse(setCookie: string[], status = 200) {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  for (const c of setCookie) headers.append("set-cookie", c);
  return new Response(JSON.stringify({ ok: true }), { status, headers });
}

function changePasswordRequest() {
  return new Request("http://academy.test/api/backend/auth/change-password", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "__Host-trading_platform_session=old-token; trading_platform_csrf=t",
      "x-csrf-token": "t",
    },
    body: JSON.stringify({ currentPassword: "old-one", newPassword: "new-one" }),
  });
}

beforeEach(() => {
  process.env.ACADEMY_MODE = "api";
  process.env.BACKEND_ORIGIN = ORIGIN;
  resetAcademyConfigCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetAcademyConfigCache();
});

describe("the change-password proxy", () => {
  it("is the operation the allow-list names, and reaches only that path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendResponse([ROTATED]));
    vi.stubGlobal("fetch", fetchMock);

    await proxyToBackend(changePasswordRequest(), "changePassword");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${ORIGIN}/api/auth/change-password`);
    expect(PROXY_ALLOW_LIST.changePassword.backendPath).toBe("/api/auth/change-password");
  });

  it("passes the rotated cookie through byte for byte", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(backendResponse([ROTATED])));

    const response = await proxyToBackend(changePasswordRequest(), "changePassword");
    const out = response.headers.getSetCookie();

    expect(out).toHaveLength(1);
    expect(out[0]).toBe(ROTATED);

    /* Named individually, so a rewrite that keeps the cookie but loses one
       attribute fails on the attribute rather than passing on the name. */
    expect(out[0]).toContain("__Host-trading_platform_session=");
    expect(out[0]).toContain("rotated-token-value");
    expect(out[0]).toContain("Path=/");
    expect(out[0]).toContain("HttpOnly");
    expect(out[0]).toContain("Secure");
    expect(out[0]).toContain("SameSite=Strict");
    expect(out[0]).toContain("Max-Age=604800");
  });

  it("keeps several Set-Cookie headers separate rather than joining them", async () => {
    const legacyCleared = "trading_platform_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(backendResponse([ROTATED, legacyCleared])));

    const out = (await proxyToBackend(changePasswordRequest(), "changePassword")).headers.getSetCookie();

    expect(out).toHaveLength(2);
    expect(out).toContain(ROTATED);
    expect(out).toContain(legacyCleared);
    /* A single comma-joined line is the classic way two cookies become one
       broken one; neither value may contain the other. */
    expect(out[0]).not.toContain(legacyCleared);
    expect(out[1]).not.toContain("rotated-token-value");
  });

  it("does not invent a cookie when the Backend refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "INVALID_CURRENT_PASSWORD" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const response = await proxyToBackend(changePasswordRequest(), "changePassword");

    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("sends the body the caller wrote and nothing the browser could smuggle in headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendResponse([ROTATED]));
    vi.stubGlobal("fetch", fetchMock);

    await proxyToBackend(changePasswordRequest(), "changePassword");

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    /* The proxy forwards the body as bytes, not a string: it reads an
       ArrayBuffer so it can enforce a size limit before parsing anything. */
    const forwarded = new TextDecoder().decode(init.body as ArrayBuffer);
    expect(JSON.parse(forwarded)).toEqual({
      currentPassword: "old-one",
      newPassword: "new-one",
    });
    const sent = new Headers(init.headers as HeadersInit);
    expect(sent.get("cookie")).toContain("__Host-trading_platform_session=old-token");
    expect(sent.get("x-csrf-token")).toBe("t");
  });
});
