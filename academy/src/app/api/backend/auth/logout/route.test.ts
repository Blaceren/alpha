import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAcademyConfigCache } from "@/config/academy-config";
import { PROXY_ALLOW_LIST } from "@/server/proxy/allow-list";
import { LEGACY_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { POST } from "./route";

/**
 * «Выйти» ends the session on this device whatever the Backend answers
 * (2026-10-04, launch audit): a refused logout used to leave a valid session in
 * the browser while the shell went to /login.
 */
const ORIGIN = "http://127.0.0.1:3212";
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = { ACADEMY_MODE: process.env.ACADEMY_MODE, BACKEND_ORIGIN: process.env.BACKEND_ORIGIN };
  process.env.ACADEMY_MODE = "api";
  process.env.BACKEND_ORIGIN = ORIGIN;
  resetAcademyConfigCache();
});
afterEach(() => {
  process.env.ACADEMY_MODE = saved.ACADEMY_MODE;
  process.env.BACKEND_ORIGIN = saved.BACKEND_ORIGIN;
  resetAcademyConfigCache();
  vi.unstubAllGlobals();
});

function backend(status: number, setCookie?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (setCookie) headers.append("set-cookie", setCookie);
  return new Response(JSON.stringify(status === 200 ? { ok: true } : { error: "Too many requests" }), { status, headers });
}
const request = () => new Request("http://academy.test/api/backend/auth/logout", { method: "POST" });
const cookies = (res: Response) => res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];

describe("logout", () => {
  it("is counted against the learner's own address, not the proxy's", () => {
    expect(PROXY_ALLOW_LIST.logout.forwardClientIp).toBe(true);
  });

  it("passes an accepted logout through as the Backend answered it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(backend(200, `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0`)));
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(cookies(res).join("\n")).toContain(`${SESSION_COOKIE_NAME}=;`);
  });

  it("still expires both session cookies when the Backend refuses", async () => {
    for (const status of [429, 503]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(backend(status)));
      const res = await POST(request());
      expect(res.status).toBe(status);
      const set = cookies(res).join("\n");
      expect(set).toMatch(new RegExp(`${SESSION_COOKIE_NAME.replace(/[-]/g, "\\-")}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`));
      expect(set).toContain(`${LEGACY_SESSION_COOKIE_NAME}=; Path=/; Max-Age=0`);
    }
  });
});
