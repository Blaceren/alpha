/**
 * The News Calendar's server read: the learner's own session, the one constant
 * path with no day (now ± 36 h), the learner's today in their saved plan's
 * zone, and null — never a guess — on anything but a well-formed answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined) }),
}));
vi.mock("@/config/academy-config", () => ({
  getAcademyConfig: () => ({ mode: "api", backendOrigin: "http://127.0.0.1:3215", requestTimeoutMs: 5000 }),
}));

import { readNewsCalendarOnServer } from "./news-read";

const PLAN = {
  version: 1,
  timeZone: "Asia/Tokyo",
  minImportance: 3,
  minutesBefore: 15,
  minutesAfter: 15,
  currencies: ["USD"],
  savedAt: "2026-09-20T10:00:00.000Z",
};
const STATE = {
  plan: PLAN,
  window: { from: "2026-09-20T00:18:00.000Z", to: "2026-09-23T00:18:00.000Z" },
  events: [],
  reference: { currencies: ["USD"], countries: [], importance: [], minutes: [15], planImportance: [3] },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  cookieJar.clear();
  cookieJar.set("__Host-trading_platform_session", "abc");
  vi.useFakeTimers({ toFake: ["Date"] });
  // 20:00 UTC is already the next day in Tokyo.
  vi.setSystemTime(new Date("2026-09-21T20:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("readNewsCalendarOnServer", () => {
  it("reads the plan and the releases around now, and the learner's today in the plan's zone", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: STATE }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(readNewsCalendarOnServer()).resolves.toEqual({ state: STATE, day: "2026-09-22" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:3215/api/tools/news-calendar");
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("manual");
    expect(init.headers.cookie).toContain("__Host-trading_platform_session=abc");
  });

  it("knows no day without a plan", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: { ...STATE, plan: null } })));
    await expect(readNewsCalendarOnServer()).resolves.toEqual({ state: { ...STATE, plan: null }, day: null });
  });

  it("asks nothing without a session, and returns null for a locked tool or a malformed answer", async () => {
    cookieJar.clear();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(readNewsCalendarOnServer()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    cookieJar.set("__Host-trading_platform_session", "abc");
    for (const response of [json({ error: "TOOL_LOCKED" }, 403), json({ data: { plan: "x" } }), new Response("nope")]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(readNewsCalendarOnServer()).resolves.toBeNull();
    }
  });
});
