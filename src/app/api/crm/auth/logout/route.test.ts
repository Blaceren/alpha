/**
 * The CRM logout route forwards the ingress-measured address (2026-10-07 audit):
 * without it every employee's logout reached the backend from this server's own
 * address and shared one bucket. And whatever the backend says, this browser
 * leaves without CRM cookies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { SESSION_COOKIE_NAME } from "@/server/set-cookie-bridge";

const ORIGIN = "http://127.0.0.1:3399";
let originalOrigin: string | undefined;

beforeEach(() => {
  originalOrigin = process.env.CRM_BACKEND_ORIGIN;
  process.env.CRM_BACKEND_ORIGIN = ORIGIN;
});

afterEach(() => {
  process.env.CRM_BACKEND_ORIGIN = originalOrigin;
  vi.unstubAllGlobals();
});

function logoutRequest(headers: Record<string, string> = {}) {
  return new Request("http://crm.test/api/crm/auth/logout", {
    method: "POST",
    headers: { cookie: `${SESSION_COOKIE_NAME}=held; trading_platform_csrf=t`, "x-csrf-token": "t", ...headers },
  });
}

describe("CRM logout route", () => {
  it("forwards the measured client address, not this server's", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    await POST(logoutRequest({ "x-real-ip": "203.0.113.9" }));
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    const headers = init.headers as Record<string, string>;
    expect(headers["x-real-ip"]).toBe("203.0.113.9");
    expect(headers["x-forwarded-for"]).toBe("203.0.113.9");
  });

  it("clears this browser's session cookie even when the backend cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const res = await POST(logoutRequest());
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=;`) && /Max-Age=0/i.test(cookie))).toBe(true);
  });
});
