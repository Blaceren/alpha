/**
 * The Trading Journal's server read: the learner's own session, the first page
 * of the whole journal, and null — never a guess — on anything but a
 * well-formed answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined) }),
}));
vi.mock("@/config/academy-config", () => ({
  getAcademyConfig: () => ({ mode: "api", backendOrigin: "http://127.0.0.1:3215", requestTimeoutMs: 5000 }),
}));

import { readJournalOnServer } from "./journal-read";

const PAGE = {
  entries: [],
  nextCursor: null,
  summary: { total: 0, onPlan: 0, violated: 0, unmarked: 0, withoutConclusion: 0 },
  filter: "all",
  reference: {
    assets: [{ code: "EURUSD_OTC", label: "EUR/USD OTC", group: "currency_otc" }],
    expiries: [{ code: "M3", label: "3 мин", seconds: 180 }],
    violations: [{ code: "revenge", label: "Хотел отыграться после убытка" }],
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

describe("readJournalOnServer", () => {
  it("reads the first page of the learner's own journal, with their session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: PAGE }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(readJournalOnServer()).resolves.toEqual(PAGE);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:3215/api/tools/journal?filter=all");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    expect(init.cache).toBe("no-store");
    expect(init.headers.cookie).toContain("__Host-trading_platform_session=abc");
  });

  it("asks nothing without a session", async () => {
    cookieJar.clear();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(readJournalOnServer()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null for a locked tool, a failure or a malformed answer", async () => {
    for (const response of [
      json({ error: "TOOL_LOCKED" }, 403),
      json({ error: "UNAUTHORIZED" }, 401),
      json({ data: { ...PAGE, entries: [{ id: 1 }] } }),
      json({ data: { ...PAGE, summary: { total: -1 } } }),
      json({ data: { ...PAGE, filter: "everything" } }),
      new Response("not json", { status: 200 }),
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(readJournalOnServer()).resolves.toBeNull();
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(readJournalOnServer()).resolves.toBeNull();
  });
});
