import { afterEach, describe, expect, it, vi } from "vitest";
import { changeTradeCard, fetchTradeCardState, fixTradePlan, isTradeCard } from "./trade-card-client";

const CARD = {
  id: "cm3k9x2p10000abcdefghij",
  status: "fixed",
  plan: {
    asset: { code: "EURUSD_OTC", label: "EUR/USD OTC" },
    direction: "up",
    amount: "8.00",
    payoutPercent: 90,
    expiry: { code: "M3", label: "3 мин", seconds: 180 },
    entryTime: "14:32",
    reason: "Отскок",
  },
  outcomes: { ifRight: "7.20", ifWrong: "8.00" },
  fixedAt: "2026-09-21T11:32:00.000Z",
  planRevisionCount: 0,
  result: null,
  observation: null,
  savedAt: null,
  cancelledAt: null,
  createdAt: "2026-09-21T11:31:00.000Z",
};
const REFERENCE = {
  assets: [{ code: "EURUSD_OTC", label: "EUR/USD OTC", group: "currency_otc" }],
  expiries: [{ code: "M3", label: "3 мин", seconds: 180 }],
};
const PLAN = {
  asset: "EURUSD_OTC",
  direction: "up" as const,
  amount: "8.00",
  payoutPercent: 90,
  expiry: "M3",
  entryTime: "14:32",
  reason: "Отскок",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the Trade Card client", () => {
  it("reads the open card through the same-origin proxy, with no token and no query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: { card: CARD, reference: REFERENCE } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchTradeCardState();
    expect(result).toEqual({ ok: true, data: { card: CARD, reference: REFERENCE } });
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/backend/tools/trade-cards");
    expect(fetchMock.mock.calls[0]![1].method).toBe("GET");
    expect(fetchMock.mock.calls[0]![1].headers["x-csrf-token"]).toBeUndefined();
  });

  it("fetches a CSRF token for every write and sends it in the header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ csrfToken: "tok-1" }))
      .mockResolvedValueOnce(json({ data: { card: CARD } }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fixTradePlan(PLAN);
    expect(result).toEqual({ ok: true, data: CARD });
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/backend/csrf");
    const [path, init] = fetchMock.mock.calls[1]!;
    expect(path).toBe("/api/backend/tools/trade-cards");
    expect(init.method).toBe("POST");
    expect(init.headers["x-csrf-token"]).toBe("tok-1");
    expect(JSON.parse(init.body)).toEqual({ plan: PLAN });
  });

  it("changes a card with PATCH on its own path", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ csrfToken: "tok-2" }))
      .mockResolvedValueOnce(json({ data: { card: { ...CARD, status: "cancelled", cancelledAt: "2026-09-21T11:40:00.000Z" } } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await changeTradeCard(CARD.id, { action: "cancel" });
    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls[1]![0]).toBe(`/api/backend/tools/trade-cards/${CARD.id}`);
    expect(fetchMock.mock.calls[1]![1].method).toBe("PATCH");
  });

  it("hands back the Backend's code and the refused field", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ csrfToken: "tok" }))
        .mockResolvedValueOnce(json({ error: "TOOL_VALIDATION", detail: "invalid_amount", requestId: "r1" }, 400)),
    );
    const result = await fixTradePlan(PLAN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TOOL_VALIDATION");
      expect(result.detail).toBe("invalid_amount");
    }
  });

  it("ignores a detail that is not a field code", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ csrfToken: "tok" }))
        .mockResolvedValueOnce(json({ error: "TOOL_VALIDATION", detail: "<script>alert(1)</script>" }, 400)),
    );
    const result = await fixTradePlan(PLAN);
    expect(!result.ok && result.detail).toBeNull();
  });

  it("does not write when the token cannot be had", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ error: "UNAUTHORIZED" }, 401));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fixTradePlan(PLAN);
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("calls a malformed answer malformed, not a card", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: { card: { id: 1 }, reference: REFERENCE } })));
    const result = await fetchTradeCardState();
    expect(!result.ok && result.error.category).toBe("MALFORMED_RESPONSE");
  });

  it("calls a network failure a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const result = await fetchTradeCardState();
    expect(!result.ok && result.error.category).toBe("NETWORK_ERROR");
  });

  it("accepts exactly the card shape the Backend sends", () => {
    expect(isTradeCard(CARD)).toBe(true);
    expect(isTradeCard({ ...CARD, status: "draft" })).toBe(false);
    expect(isTradeCard({ ...CARD, result: "draw" })).toBe(false);
    expect(isTradeCard({ ...CARD, plan: { ...CARD.plan, direction: "sideways" } })).toBe(false);
  });
});
