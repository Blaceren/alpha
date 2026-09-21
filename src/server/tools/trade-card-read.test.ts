/**
 * The Trade Card's server read: the learner's own session, one constant path,
 * and null — never a guess — on anything but a well-formed answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined) }),
}));
vi.mock("@/config/academy-config", () => ({
  getAcademyConfig: () => ({ mode: "api", backendOrigin: "http://127.0.0.1:3215", requestTimeoutMs: 5000 }),
}));

import { readTradeCardStateOnServer } from "./trade-card-read";

const STATE = {
  card: null,
  reference: {
    assets: [{ code: "EURUSD_OTC", label: "EUR/USD OTC", group: "currency_otc" }],
    expiries: [{ code: "M3", label: "3 мин", seconds: 180 }],
  },
};
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

describe("readTradeCardStateOnServer", () => {
  it("reads the learner's own card through the one constant path, with their session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: STATE }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(readTradeCardStateOnServer()).resolves.toEqual(STATE);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:3215/api/tools/trade-cards");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    expect(init.headers.cookie).toContain("__Host-trading_platform_session=abc");
  });

  it("asks nothing without a session", async () => {
    cookieJar.clear();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(readTradeCardStateOnServer()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null for a locked tool, a failure or a malformed answer", async () => {
    for (const response of [
      json({ error: "TOOL_LOCKED" }, 403),
      json({ error: "UNAUTHORIZED" }, 401),
      json({ data: { card: { id: 1 }, reference: STATE.reference } }),
      new Response("not json", { status: 200 }),
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(readTradeCardStateOnServer()).resolves.toBeNull();
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(readTradeCardStateOnServer()).resolves.toBeNull();
  });
});
