import { describe, expect, it } from "vitest";
import { ToolError } from "./errors";
import { computeStats, parseStatsQuery, toJournalStatsDto, type StatsEntry } from "./stats";

const NOW = new Date("2026-09-21T12:00:00.000Z");

function refused(raw: string): string | null {
  try {
    parseStatsQuery(new URLSearchParams(raw), NOW);
    return null;
  } catch (error) {
    return error instanceof ToolError ? `${error.code}:${error.detail}` : "other";
  }
}

/** The presentation's example: 38 trades, 21 wins, 31 on plan (19 wins), 7 broken (2 wins). */
function presentationJournal(): StatsEntry[] {
  const entries: StatsEntry[] = [];
  const add = (count: number, result: string, planFollowed: boolean | null, codes: string[][] = []) => {
    for (let n = 0; n < count; n += 1) {
      entries.push({ result, planFollowed, payoutPercent: 88, violations: (codes[n] ?? []).map((code) => ({ code })) });
    }
  };
  add(19, "profit", true);
  add(12, "loss", true);
  add(2, "profit", false, [["no_reason"], ["news_nearby"]]);
  add(5, "loss", false, [["no_reason"], ["no_reason"], ["news_nearby"], ["after_daily_limit"], ["after_daily_limit"]]);
  return entries;
}

describe("parseStatsQuery", () => {
  it("reads all time without a date, and a window of the learner's own days", () => {
    expect(parseStatsQuery(new URLSearchParams(""), NOW)).toEqual({ period: "all", window: null });
    expect(parseStatsQuery(new URLSearchParams("period=all&today=2026-09-21"), NOW)).toEqual({ period: "all", window: null });
    expect(parseStatsQuery(new URLSearchParams("period=7d&today=2026-09-21"), NOW)).toEqual({
      period: "7d",
      window: { from: "2026-09-15", to: "2026-09-21" },
    });
    expect(parseStatsQuery(new URLSearchParams("period=30d&today=2026-09-22"), NOW)).toEqual({
      period: "30d",
      window: { from: "2026-08-24", to: "2026-09-22" },
    });
  });

  it("refuses anything else by name", () => {
    expect(refused("period=90d&today=2026-09-21")).toBe("TOOL_VALIDATION:invalid_period");
    expect(refused("period=7d")).toBe("TOOL_VALIDATION:invalid_today");
    expect(refused("period=7d&today=2026-09-25")).toBe("TOOL_VALIDATION:invalid_today");
    expect(refused("period=7d&today=2026-02-30")).toBe("TOOL_VALIDATION:invalid_today");
    expect(refused("period=7d&period=30d&today=2026-09-21")).toBe("TOOL_VALIDATION:invalid_period");
    expect(refused("period=7d&today=2026-09-21&userId=7")).toBe("TOOL_VALIDATION:unexpected_query_parameter");
  });
});

describe("computeStats — the presentation's figures", () => {
  const stats = computeStats(presentationJournal());

  it("counts 38 trades, 21 wins: 55%", () => {
    expect(stats.trades).toBe(38);
    expect(stats.wins).toBe(21);
    expect(stats.winRateBasisPoints).toBe(5526);
  });

  it("puts break-even at 53.2% for an average payout of 88%", () => {
    expect(stats.averagePayoutTenths).toBe(880);
    expect(stats.breakEvenBasisPoints).toBe(5319);
  });

  it("finds 31 of 38 on plan, and splits the win rate: 61% on plan, 29% with a broken plan", () => {
    expect(stats.onPlan).toBe(31);
    expect(stats.onPlanBasisPoints).toBe(8158);
    expect(stats.unmarked).toBe(0);
    expect(stats.split.followed).toEqual({ trades: 31, wins: 19, winRateBasisPoints: 6129 });
    expect(stats.split.broken).toEqual({ trades: 7, wins: 2, winRateBasisPoints: 2857 });
  });

  it("counts the rules broken, most frequent first: 3 + 2 + 2", () => {
    expect(stats.violations.total).toBe(7);
    expect(stats.violations.items).toEqual([
      { code: "no_reason", label: "Вход без записанной причины", count: 3 },
      { code: "news_nearby", label: "Рядом важная новость", count: 2 },
      { code: "after_daily_limit", label: "Сделка после дневного лимита", count: 2 },
    ]);
  });

  it("calls a sample under fifty trades preliminary", () => {
    expect(stats.preliminary).toBe(true);
    const fifty = Array.from({ length: 50 }, () => ({ result: "profit", planFollowed: null, payoutPercent: 90, violations: [] }));
    expect(computeStats(fifty).preliminary).toBe(false);
  });
});

describe("computeStats — the edges", () => {
  it("has no rates for an empty window", () => {
    expect(computeStats([])).toMatchObject({
      trades: 0,
      winRateBasisPoints: null,
      averagePayoutTenths: null,
      breakEvenBasisPoints: null,
      onPlanBasisPoints: null,
      split: { followed: { trades: 0, winRateBasisPoints: null }, broken: { trades: 0, winRateBasisPoints: null } },
      violations: { total: 0, items: [] },
    });
  });

  it("keeps unmarked trades in the totals and out of the split", () => {
    const stats = computeStats([
      { result: "profit", planFollowed: null, payoutPercent: 80, violations: [] },
      { result: "loss", planFollowed: true, payoutPercent: 90, violations: [] },
    ]);
    expect(stats.trades).toBe(2);
    expect(stats.unmarked).toBe(1);
    expect(stats.split.followed.trades + stats.split.broken.trades).toBe(1);
    expect(stats.averagePayoutTenths).toBe(850);
  });

  it("carries no money at all", () => {
    const dto = toJournalStatsDto({ period: "all", window: null }, computeStats(presentationJournal()));
    const text = JSON.stringify(dto);
    expect(text).not.toMatch(/amount|balance|profitMinor|resultAmount|sum/i);
    expect(dto.minSample).toBe(50);
  });
});
