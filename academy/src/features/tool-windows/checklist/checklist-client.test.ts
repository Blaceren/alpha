import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchChecklistState, isChecklistState, isEntryCheck, saveEntryCheck } from "./checklist-client";

const ITEMS = [
  { code: "no_news", group: "environment", stop: true, label: "Рядом нет важной новости (±15 мин)" },
  { code: "attention", group: "state", stop: false, label: "Внимание на графике, не устал" },
];
const CHECK = {
  id: "cmcheck0000000abcdefghij",
  asset: { code: "EURUSD_OTC", label: "EUR/USD OTC" },
  minPayoutPercent: 85,
  answers: { no_news: true, attention: false },
  verdict: "skip_condition",
  missingItem: "attention",
  createdAt: "2026-09-21T12:00:00.000Z",
};
const STATE = {
  recent: [CHECK],
  lastMinPayoutPercent: 85,
  checklist: { groups: [{ code: "environment", label: "Среда" }], items: ITEMS },
  reference: { assets: [{ code: "EURUSD_OTC", label: "EUR/USD OTC", group: "currency_otc" }] },
};
const INPUT = { asset: "EURUSD_OTC", minPayoutPercent: 85, answers: { no_news: true, attention: false } };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the Entry Checklist client", () => {
  it("reads through the same-origin proxy, with no token and no query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: STATE }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchChecklistState()).resolves.toEqual({ ok: true, data: STATE });
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("/api/backend/tools/entry-checks");
    expect(init.method).toBe("GET");
    expect(init.headers["x-csrf-token"]).toBeUndefined();
  });

  it("keeps a check with POST, the check as the body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ csrfToken: "tok-1" }))
      .mockResolvedValueOnce(json({ data: { check: CHECK, recent: [CHECK], lastMinPayoutPercent: 85 } }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const result = await saveEntryCheck(INPUT);
    expect(result.ok && result.data.check).toEqual(CHECK);
    const [path, init] = fetchMock.mock.calls[1]!;
    expect(path).toBe("/api/backend/tools/entry-checks");
    expect(init.method).toBe("POST");
    expect(init.headers["x-csrf-token"]).toBe("tok-1");
    expect(JSON.parse(init.body)).toEqual({ check: INPUT });
  });

  it("accepts exactly the shapes the Backend sends", () => {
    expect(isEntryCheck(CHECK)).toBe(true);
    expect(isEntryCheck({ ...CHECK, verdict: "maybe" })).toBe(false);
    expect(isEntryCheck({ ...CHECK, verdict: "enter" })).toBe(false);
    expect(isEntryCheck({ ...CHECK, minPayoutPercent: 0 })).toBe(false);
    expect(isEntryCheck({ ...CHECK, answers: { no_news: "yes" } })).toBe(false);
    expect(isChecklistState(STATE)).toBe(true);
    expect(isChecklistState({ ...STATE, checklist: { ...STATE.checklist, items: [] } })).toBe(false);
    expect(isChecklistState({ ...STATE, reference: { assets: [] } })).toBe(false);
  });
});
