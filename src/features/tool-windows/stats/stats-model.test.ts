import { describe, expect, it } from "vitest";
import {
  againstBreakEven,
  ofWords,
  payoutWords,
  preciseWords,
  rateWords,
  sampleWords,
  tradesWords,
  windowWords,
} from "./stats-model";

describe("the words of the figures", () => {
  it("says rates in whole percents, as the presentation does", () => {
    expect(rateWords(5526)).toBe("55%");
    expect(rateWords(8158)).toBe("82%");
    expect(rateWords(2857)).toBe("29%");
    expect(rateWords(null)).toBe("—");
  });

  it("keeps one decimal for break-even, the line rates are read against", () => {
    expect(preciseWords(5319)).toBe("53.2%");
    expect(preciseWords(5000)).toBe("50%");
    expect(payoutWords(880)).toBe("88%");
    expect(payoutWords(875)).toBe("87.5%");
  });

  it("counts trades in Russian", () => {
    expect(tradesWords(1)).toBe("1 сделка");
    expect(tradesWords(3)).toBe("3 сделки");
    expect(tradesWords(38)).toBe("38 сделок");
    expect(ofWords(21, 38)).toBe("21 из 38");
    expect(sampleWords(38)).toBe("Выборка — 38 сделок, выводы предварительные.");
  });

  it("names the window in the learner's calendar words", () => {
    expect(windowWords({ from: "2026-09-15", to: "2026-09-21" })).toBe("15–21 сентября");
    expect(windowWords({ from: "2026-08-24", to: "2026-09-22" })).toBe("24 августа – 22 сентября");
    expect(windowWords(null)).toBeNull();
  });

  it("reads a side's win rate against break-even, and says nothing of a tiny side", () => {
    expect(againstBreakEven({ trades: 31, winRateBasisPoints: 6129 }, 5319)).toBe("above");
    expect(againstBreakEven({ trades: 7, winRateBasisPoints: 2857 }, 5319)).toBe("below");
    expect(againstBreakEven({ trades: 5, winRateBasisPoints: 5319 }, 5319)).toBe("above");
    // One lucky trade with a broken plan is not «нарушать выгодно».
    expect(againstBreakEven({ trades: 1, winRateBasisPoints: 10_000 }, 5319)).toBe("few");
    expect(againstBreakEven({ trades: 0, winRateBasisPoints: null }, 5319)).toBeNull();
  });
});
