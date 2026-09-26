/**
 * The Risk Calculator's server read: the learner's own session, the one
 * constant path, and null — never a guess — on anything but a well-formed answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined) }),
}));
vi.mock("@/config/academy-config", () => ({
  getAcademyConfig: () => ({ mode: "api", backendOrigin: "http://127.0.0.1:3215", requestTimeoutMs: 5000 }),
}));

import { readRiskStateOnServer } from "./risk-read";

const STATE = { plan: null, history: [], reference: { riskShares: [1, 2, 3, 5], streakLength: 5 } };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  cookieJar.clear();
  cookieJar.set("__Host-trading_platform_session", "abc");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("readRiskStateOnServer", () => {
  it("reads the learner's own plan through the one constant path, with their session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: STATE }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(readRiskStateOnServer()).resolves.toEqual(STATE);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:3215/api/tools/risk-plan");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    expect(init.cache).toBe("no-store");
    expect(init.headers.cookie).toContain("__Host-trading_platform_session=abc");
  });

  it("asks nothing without a session", async () => {
    cookieJar.clear();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(readRiskStateOnServer()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null for a locked tool, a failure or a malformed answer", async () => {
    for (const response of [
      json({ error: "TOOL_LOCKED" }, 403),
      json({ data: { ...STATE, plan: { id: 1 } } }),
      json({ data: { ...STATE, reference: { riskShares: [] } } }),
      new Response("not json", { status: 200 }),
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(readRiskStateOnServer()).resolves.toBeNull();
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(readRiskStateOnServer()).resolves.toBeNull();
  });
});
