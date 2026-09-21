import { describe, expect, it } from "vitest";
import {
  adjustSummary,
  compareEntries,
  dayHeading,
  draftResultMoney,
  emptyManualDraft,
  fieldOfServerDetail,
  formatTradeDate,
  groupByDay,
  isReviewed,
  manualDraftOf,
  matchesFilter,
  placeEntry,
  resultMoney,
  reviewDraftOf,
  summaryWithEntry,
  validateManual,
  validateReview,
  yearInViewOf,
  type JournalEntry,
  type JournalReference,
  type ManualDraft,
} from "./journal-model";

const REFERENCE: JournalReference = {
  assets: [{ code: "EURUSD_OTC", label: "EUR/USD OTC", group: "currency_otc" }],
  expiries: [{ code: "M3", label: "3 мин", seconds: 180 }],
  violations: [
    { code: "no_reason", label: "Вход без записанной причины" },
    { code: "revenge", label: "Хотел отыграться после убытка" },
  ],
};

let serial = 0;
function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  serial += 1;
  return {
    id: `cm4j0urnal${String(serial).padStart(4, "0")}abcdefghij`,
    source: "manual",
    tradeCardId: null,
    tradeDate: "2026-09-21",
    entryTime: "14:32",
    asset: { code: "EURUSD_OTC", label: "EUR/USD OTC" },
    direction: "up",
    amount: "8.00",
    payoutPercent: 90,
    expiry: { code: "M3", label: "3 мин", seconds: 180 },
    result: "profit",
    resultAmount: "7.20",
    plan: null,
    execution: null,
    conclusion: null,
    planFollowed: null,
    violations: [],
    createdAt: "2026-09-21T12:00:00.000Z",
    updatedAt: "2026-09-21T12:00:00.000Z",
    ...overrides,
  };
}

function draft(overrides: Partial<ManualDraft> = {}): ManualDraft {
  return {
    tradeDate: "2026-09-20",
    entryTime: "10:05",
    asset: "EURUSD_OTC",
    direction: "down",
    amount: "12,5",
    payoutPercent: "88",
    expiry: "M3",
    result: "loss",
    plan: "  ",
    planMark: "broken",
    violations: ["revenge"],
    execution: " Вошёл сразу после убытка ",
    conclusion: "",
    ...overrides,
  };
}

const NOW = new Date(2026, 8, 21, 15, 0);

describe("dates on screen", () => {
  it("names a day in words, with the year only when it is not the year in view", () => {
    expect(dayHeading("2026-09-21", 2026)).toEqual({ date: "21 сентября", weekday: "понедельник" });
    expect(dayHeading("2025-12-31", 2026)).toEqual({ date: "31 декабря 2025", weekday: "среда" });
    expect(formatTradeDate("2026-09-21", 2026)).toBe("21 сен");
    expect(formatTradeDate("2025-09-21", 2026)).toBe("21 сен 2025");
  });

  it("takes the year in view from the newest entry, never a clock", () => {
    expect(yearInViewOf([entry({ tradeDate: "2025-01-02" })])).toBe(2025);
    expect(yearInViewOf([])).toBeNull();
  });

  it("groups consecutive entries of a day, keeping the order", () => {
    const a = entry({ tradeDate: "2026-09-21", entryTime: "15:00" });
    const b = entry({ tradeDate: "2026-09-21", entryTime: "09:00" });
    const c = entry({ tradeDate: "2026-09-19" });
    expect(groupByDay([a, b, c])).toEqual([
      { tradeDate: "2026-09-21", entries: [a, b] },
      { tradeDate: "2026-09-19", entries: [c] },
    ]);
  });
});

describe("the list's order and counts", () => {
  it("sorts the way the Backend does: date, entry time, then when recorded", () => {
    const newer = entry({ tradeDate: "2026-09-21", entryTime: "09:00" });
    const later = entry({ tradeDate: "2026-09-20", entryTime: "23:00" });
    const first = entry({ tradeDate: "2026-09-20", entryTime: "10:00", createdAt: "2026-09-20T10:00:00.000Z" });
    const second = entry({ tradeDate: "2026-09-20", entryTime: "10:00", createdAt: "2026-09-20T11:00:00.000Z" });
    expect([first, later, second, newer].sort(compareEntries)).toEqual([newer, later, second, first]);
  });

  it("places an entry where it belongs, and leaves one for a later page alone", () => {
    const top = entry({ tradeDate: "2026-09-21" });
    const bottom = entry({ tradeDate: "2026-09-10" });
    const middle = entry({ tradeDate: "2026-09-15" });
    const older = entry({ tradeDate: "2026-09-01" });
    expect(placeEntry([top, bottom], middle, true)).toEqual([top, middle, bottom]);
    expect(placeEntry([top, bottom], older, true)).toEqual([top, bottom]);
    expect(placeEntry([top, bottom], older, false)).toEqual([top, bottom, older]);
    // A changed entry moves rather than doubles.
    const moved = { ...top, tradeDate: "2026-09-12" };
    expect(placeEntry([top, middle, bottom], moved, false)).toEqual([middle, moved, bottom]);
  });

  it("filters the way the Backend does", () => {
    expect(matchesFilter(entry({ planFollowed: false }), "violated")).toBe(true);
    expect(matchesFilter(entry({ planFollowed: null }), "violated")).toBe(false);
    expect(matchesFilter(entry({ conclusion: null }), "no_conclusion")).toBe(true);
    expect(matchesFilter(entry({ conclusion: "Итог" }), "no_conclusion")).toBe(false);
    expect(matchesFilter(entry(), "all")).toBe(true);
  });

  it("keeps the counts true after a review and after a new entry", () => {
    const summary = { total: 3, onPlan: 1, violated: 1, unmarked: 1, withoutConclusion: 2 };
    const before = entry({ planFollowed: null, conclusion: null });
    const after = { ...before, planFollowed: false, conclusion: "Пауза после убытка" };
    expect(adjustSummary(summary, before, after)).toEqual({
      total: 3,
      onPlan: 1,
      violated: 2,
      unmarked: 0,
      withoutConclusion: 1,
    });
    expect(summaryWithEntry(summary, entry({ planFollowed: true, conclusion: null }))).toEqual({
      total: 4,
      onPlan: 2,
      violated: 1,
      unmarked: 1,
      withoutConclusion: 3,
    });
  });

  it("shows each trade's own money, and nothing summed", () => {
    expect(resultMoney({ result: "profit", resultAmount: "7.20" })).toEqual({ kind: "gain", text: "+$7.20" });
    expect(resultMoney({ result: "loss", resultAmount: "16.00" })).toEqual({ kind: "loss", text: "−$16.00" });
    expect(draftResultMoney({ amount: "8", payoutPercent: "90", result: "profit" })).toEqual({ kind: "gain", text: "+$7.20" });
    expect(draftResultMoney({ amount: "8", payoutPercent: "90", result: "loss" })).toEqual({ kind: "loss", text: "−$8.00" });
    expect(draftResultMoney({ amount: "8", payoutPercent: "90", result: "" })).toBeNull();
  });

  it("calls an entry reviewed once the learner has marked or written anything", () => {
    expect(isReviewed(entry())).toBe(false);
    expect(isReviewed(entry({ planFollowed: true }))).toBe(true);
    expect(isReviewed(entry({ execution: "Вход по плану" }))).toBe(true);
  });
});

describe("the review", () => {
  it("sends rules only with a broken plan, trimmed texts, and null for nothing", () => {
    expect(validateReview({ planMark: "followed", violations: ["revenge"], execution: "  ", conclusion: " Итог " })).toEqual({
      ok: true,
      review: { planFollowed: true, violations: [], execution: null, conclusion: "Итог" },
    });
    expect(validateReview({ planMark: "broken", violations: ["revenge", "revenge"], execution: "", conclusion: "" })).toEqual({
      ok: true,
      review: { planFollowed: false, violations: ["revenge"], execution: null, conclusion: null },
    });
    expect(validateReview({ planMark: "", violations: [], execution: "", conclusion: "" })).toEqual({
      ok: true,
      review: { planFollowed: null, violations: [], execution: null, conclusion: null },
    });
  });

  it("refuses a text past its limit", () => {
    const result = validateReview({ planMark: "", violations: [], execution: "x".repeat(2001), conclusion: "" });
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors)).toEqual(["execution"]);
  });

  it("reads an entry back into the form", () => {
    expect(reviewDraftOf(entry({ planFollowed: false, violations: ["revenge"], execution: "Вход", conclusion: null }))).toEqual({
      planMark: "broken",
      violations: ["revenge"],
      execution: "Вход",
      conclusion: "",
    });
  });
});

describe("a hand-recorded trade", () => {
  it("starts on the learner's own today and time", () => {
    const blank = emptyManualDraft(new Date(2026, 8, 21, 9, 7));
    expect(blank.tradeDate).toBe("2026-09-21");
    expect(blank.entryTime).toBe("09:07");
    expect(blank.result).toBe("");
  });

  it("becomes exactly what the Backend accepts", () => {
    expect(validateManual(draft(), REFERENCE, NOW)).toEqual({
      ok: true,
      entry: {
        tradeDate: "2026-09-20",
        entryTime: "10:05",
        asset: "EURUSD_OTC",
        direction: "down",
        amount: "12.50",
        payoutPercent: 88,
        expiry: "M3",
        result: "loss",
        plan: null,
        planFollowed: false,
        violations: ["revenge"],
        execution: "Вошёл сразу после убытка",
        conclusion: null,
      },
    });
  });

  it("names every missing field at once", () => {
    const result = validateManual(
      draft({ asset: "", direction: "", amount: "0", payoutPercent: "101", expiry: "", result: "", entryTime: "9:5" }),
      REFERENCE,
      NOW,
    );
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(
      ["amount", "asset", "direction", "entryTime", "expiry", "payoutPercent", "result"].sort(),
    );
  });

  it("takes a date from 2020 to the learner's today, and nothing else", () => {
    const dateError = (tradeDate: string) => {
      const result = validateManual(draft({ tradeDate }), REFERENCE, NOW);
      return !result.ok && result.errors.tradeDate !== undefined;
    };
    expect(dateError("2026-09-21")).toBe(false);
    expect(dateError("2020-01-01")).toBe(false);
    expect(dateError("2026-09-22")).toBe(true);
    expect(dateError("2019-12-31")).toBe(true);
    expect(dateError("2026-02-30")).toBe(true);
    expect(dateError("21.09.2026")).toBe(true);
  });

  it("reads a hand-recorded entry back into the form", () => {
    const recorded = entry({ direction: "down", result: "loss", plan: "Уровень", payoutPercent: 85 });
    expect(manualDraftOf(recorded)).toMatchObject({
      tradeDate: "2026-09-21",
      direction: "down",
      amount: "8.00",
      payoutPercent: "85",
      result: "loss",
      plan: "Уровень",
      planMark: "",
    });
  });

  it("maps the Backend's refused field onto the form", () => {
    expect(fieldOfServerDetail("invalid_tradeDate")).toBe("tradeDate");
    expect(fieldOfServerDetail("invalid_violations")).toBe("violations");
    expect(fieldOfServerDetail("invalid_change")).toBeNull();
    expect(fieldOfServerDetail(null)).toBeNull();
  });
});
