import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchStats, isJournalStats, statsPath } from "./stats-client";

const STATS = {
  period: "7d",
  window: { from: "2026-09-15", to: "2026-09-21" },
  trades: 38,
  wins: 21,
  winRateBasisPoints: 5526,
  averagePayoutTenths: 880,
  breakEvenBasisPoints: 5319,
  onPlan: 31,
  onPlanBasisPoints: 8158,
  unmarked: 0,
  split: {
    followed: { trades: 31, wins: 19, winRateBasisPoints: 6129 },
    broken: { trades: 7, wins: 2, winRateBasisPoints: 2857 },
  },
  violations: { total: 3, items: [{ code: "no_reason", label: "Вход без записанного основания", count: 3 }] },
  preliminary: true,
  minSample: 50,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the Personal Stats client", () => {
  it("asks for a period, and for 7 and 30 days the learner's own today", async () => {
    expect(statsPath("all", null)).toBe("/api/backend/tools/stats?period=all");
    expect(statsPath("7d", "2026-09-21")).toBe("/api/backend/tools/stats?period=7d&today=2026-09-21");
    const fetchMock = vi.fn().mockResolvedValue(json({ data: STATS }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchStats("7d", "2026-09-21")).resolves.toEqual({ ok: true, data: STATS });
    expect(fetchMock.mock.calls[0]![1].method).toBe("GET");
  });

  it("accepts exactly the shape the Backend sends", () => {
    expect(isJournalStats(STATS)).toBe(true);
    expect(isJournalStats({ ...STATS, period: "90d" })).toBe(false);
    expect(isJournalStats({ ...STATS, winRateBasisPoints: -1 })).toBe(false);
    expect(isJournalStats({ ...STATS, split: { ...STATS.split, broken: { trades: 7 } } })).toBe(false);
    expect(isJournalStats({ ...STATS, violations: { total: 1, items: [{ code: "x" }] } })).toBe(false);
    expect(isJournalStats({ ...STATS, window: null, period: "all" })).toBe(true);
  });
});
