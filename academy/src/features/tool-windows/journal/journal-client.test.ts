import { afterEach, describe, expect, it, vi } from "vitest";
import {
  changeJournalEntry,
  createJournalEntry,
  deleteJournalEntry,
  fetchJournalPage,
  isJournalEntry,
  isJournalPage,
  isJournalSummary,
  journalPagePath,
} from "./journal-client";

const ENTRY = {
  id: "cm4j0urnal0000abcdefghij",
  source: "trade_card",
  tradeCardId: "cm3k9x2p10000abcdefghij",
  tradeDate: "2026-09-21",
  entryTime: "14:32",
  asset: { code: "EURUSD_OTC", label: "EUR/USD OTC" },
  direction: "up",
  amount: "8.00",
  payoutPercent: 90,
  expiry: { code: "M3", label: "3 мин", seconds: 180 },
  result: "profit",
  resultAmount: "7.20",
  plan: "Отскок от уровня",
  execution: null,
  conclusion: "Вошёл по плану",
  planFollowed: null,
  violations: [],
  createdAt: "2026-09-21T11:40:00.000Z",
  updatedAt: "2026-09-21T11:40:00.000Z",
};
const PAGE = {
  entries: [ENTRY],
  nextCursor: null,
  summary: { total: 1, onPlan: 0, violated: 0, unmarked: 1, withoutConclusion: 0 },
  filter: "all",
  reference: {
    assets: [{ code: "EURUSD_OTC", label: "EUR/USD OTC", group: "currency_otc" }],
    expiries: [{ code: "M3", label: "3 мин", seconds: 180 }],
    violations: [{ code: "revenge", label: "Хотел отыграться после убытка" }],
  },
};
const MANUAL = {
  tradeDate: "2026-09-20",
  entryTime: "10:05",
  asset: "EURUSD_OTC",
  direction: "down" as const,
  amount: "5.00",
  payoutPercent: 88,
  expiry: "M3",
  result: "loss" as const,
  plan: null,
  planFollowed: false,
  violations: ["revenge"],
  execution: "Вошёл сразу после убытка",
  conclusion: null,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the Trading Journal client", () => {
  it("builds a page's address from the filter and, after the first page, the cursor only", () => {
    expect(journalPagePath("all", null)).toBe("/api/backend/tools/journal?filter=all");
    expect(journalPagePath("violated", ENTRY.id)).toBe(`/api/backend/tools/journal?filter=violated&before=${ENTRY.id}`);
  });

  it("reads a page with GET and no token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: PAGE }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchJournalPage("no_conclusion")).resolves.toEqual({ ok: true, data: PAGE });
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("/api/backend/tools/journal?filter=no_conclusion");
    expect(init.method).toBe("GET");
    expect(init.headers["x-csrf-token"]).toBeUndefined();
  });

  it("records a trade with POST and hands back the entry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ csrfToken: "tok-1" }))
      .mockResolvedValueOnce(json({ data: { entry: { ...ENTRY, source: "manual", tradeCardId: null } } }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const result = await createJournalEntry(MANUAL);
    expect(result).toEqual({ ok: true, data: { ...ENTRY, source: "manual", tradeCardId: null } });
    const [path, init] = fetchMock.mock.calls[1]!;
    expect(path).toBe("/api/backend/tools/journal");
    expect(init.method).toBe("POST");
    expect(init.headers["x-csrf-token"]).toBe("tok-1");
    expect(JSON.parse(init.body)).toEqual({ entry: MANUAL });
  });

  it("changes an entry with PATCH on its own path, the change as the body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ csrfToken: "tok-2" }))
      .mockResolvedValueOnce(json({ data: { entry: { ...ENTRY, planFollowed: true } } }));
    vi.stubGlobal("fetch", fetchMock);
    const change = { kind: "review" as const, planFollowed: true, violations: [], execution: null, conclusion: "Ок" };
    const result = await changeJournalEntry(ENTRY.id, change);
    expect(result.ok && result.data.planFollowed).toBe(true);
    const [path, init] = fetchMock.mock.calls[1]!;
    expect(path).toBe(`/api/backend/tools/journal/${ENTRY.id}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual(change);
  });

  it("replaces an entry whole under the kind «entry», whichever source it came from", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ csrfToken: "tok-3" }))
      .mockResolvedValueOnce(json({ data: { entry: { ...ENTRY, amount: "5.00", editedAfterCard: true } } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await changeJournalEntry(ENTRY.id, { kind: "entry", ...MANUAL });
    expect(result.ok && result.data.editedAfterCard).toBe(true);
    const [path, init] = fetchMock.mock.calls[1]!;
    expect(path).toBe(`/api/backend/tools/journal/${ENTRY.id}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ kind: "entry", ...MANUAL });
  });

  it("deletes an entry with DELETE on its own path — a token, no body — and hands back the counts", async () => {
    const summary = { total: 0, onPlan: 0, violated: 0, unmarked: 0, withoutConclusion: 0 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ csrfToken: "tok-4" }))
      .mockResolvedValueOnce(json({ data: { deleted: { id: ENTRY.id }, summary } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(deleteJournalEntry(ENTRY.id)).resolves.toEqual({ ok: true, data: summary });
    const [path, init] = fetchMock.mock.calls[1]!;
    expect(path).toBe(`/api/backend/tools/journal/${ENTRY.id}`);
    expect(init.method).toBe("DELETE");
    expect(init.headers["x-csrf-token"]).toBe("tok-4");
    expect(init.headers["content-type"]).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("does not take an answer about another entry, or one without counts, for a delete", async () => {
    const summary = { total: 3, onPlan: 1, violated: 1, unmarked: 1, withoutConclusion: 2 };
    for (const data of [
      { deleted: { id: "cm4j0urnal9999abcdefghij" }, summary },
      { deleted: { id: ENTRY.id } },
      { deleted: { id: ENTRY.id }, summary: { ...summary, total: -1 } },
      { summary },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce(json({ csrfToken: "tok" })).mockResolvedValueOnce(json({ data })),
      );
      const result = await deleteJournalEntry(ENTRY.id);
      expect(!result.ok && result.error.category, JSON.stringify(data)).toBe("MALFORMED_RESPONSE");
    }
  });

  it("hands back the Backend's «not found» for a delete, and sends nothing without a token", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ csrfToken: "tok" }))
        .mockResolvedValueOnce(json({ error: "JOURNAL_ENTRY_NOT_FOUND" }, 404)),
    );
    const gone = await deleteJournalEntry(ENTRY.id);
    expect(!gone.ok && gone.error.code).toBe("JOURNAL_ENTRY_NOT_FOUND");

    const fetchMock = vi.fn().mockResolvedValueOnce(json({ error: "UNAUTHENTICATED" }, 401));
    vi.stubGlobal("fetch", fetchMock);
    const refused = await deleteJournalEntry(ENTRY.id);
    expect(refused.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hands back the Backend's code and the refused field", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ csrfToken: "tok" }))
        .mockResolvedValueOnce(json({ error: "TOOL_VALIDATION", detail: "invalid_tradeDate" }, 400)),
    );
    const result = await createJournalEntry(MANUAL);
    expect(!result.ok && result.error.code).toBe("TOOL_VALIDATION");
    expect(!result.ok && result.detail).toBe("invalid_tradeDate");
  });

  it("calls a malformed page malformed, not a journal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: { ...PAGE, entries: [{ id: 1 }] } })));
    const result = await fetchJournalPage("all");
    expect(!result.ok && result.error.category).toBe("MALFORMED_RESPONSE");
  });

  it("accepts exactly the shapes the Backend sends", () => {
    expect(isJournalEntry(ENTRY)).toBe(true);
    expect(isJournalEntry({ ...ENTRY, source: "pocket" })).toBe(false);
    expect(isJournalEntry({ ...ENTRY, result: "draw" })).toBe(false);
    expect(isJournalEntry({ ...ENTRY, planFollowed: "yes" })).toBe(false);
    expect(isJournalEntry({ ...ENTRY, violations: [1] })).toBe(false);
    // The mark of an entry corrected after its card: a boolean, or — from an older Backend — absent.
    expect(isJournalEntry({ ...ENTRY, editedAfterCard: true })).toBe(true);
    expect(isJournalEntry({ ...ENTRY, editedAfterCard: false })).toBe(true);
    expect(isJournalEntry({ ...ENTRY, editedAfterCard: "yes" })).toBe(false);
    expect(isJournalSummary(PAGE.summary)).toBe(true);
    expect(isJournalSummary({ ...PAGE.summary, unmarked: undefined })).toBe(false);
    expect(isJournalPage(PAGE)).toBe(true);
    expect(isJournalPage({ ...PAGE, filter: "mine" })).toBe(false);
    expect(isJournalPage({ ...PAGE, summary: { ...PAGE.summary, total: 1.5 } })).toBe(false);
    expect(isJournalPage({ ...PAGE, reference: { ...PAGE.reference, assets: [] } })).toBe(false);
  });
});
