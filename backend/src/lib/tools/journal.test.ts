import { describe, expect, it } from "vitest";
import type { ToolTradeCard } from "@prisma/client";
import { isAcceptableTradeDate, parseTradeDate } from "./dates";
import { ToolError } from "./errors";
import {
  JOURNAL_VIOLATIONS,
  parseJournalChange,
  parseJournalManualEntry,
  parseJournalQuery,
  toJournalEntryDto,
  tradeFromCard,
  type JournalRow,
} from "./journal";
import { parseTradeCardChange } from "./trade-card";

const NOW = new Date("2026-09-21T12:00:00.000Z");

const ENTRY = {
  tradeDate: "2026-09-21",
  entryTime: "14:32",
  asset: "EURUSD_OTC",
  direction: "up",
  amount: "8",
  payoutPercent: 90,
  expiry: "M3",
  result: "profit",
  plan: "Отскок от уровня, отмеченного до сессии",
};

function refusal(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    return (error as ToolError).detail;
  }
}

describe("the learner's calendar date", () => {
  it("accepts real dates from the floor up to tomorrow in UTC", () => {
    expect(parseTradeDate("2026-02-28")).toBe("2026-02-28");
    expect(parseTradeDate("2026-02-30")).toBeNull();
    expect(parseTradeDate("26-09-21")).toBeNull();
    expect(isAcceptableTradeDate("2026-09-22", NOW)).toBe(true);
    expect(isAcceptableTradeDate("2026-09-23", NOW)).toBe(false);
    expect(isAcceptableTradeDate("2019-12-31", NOW)).toBe(false);
  });
});

describe("parseJournalManualEntry", () => {
  it("normalizes a hand-recorded trade", () => {
    expect(parseJournalManualEntry({ ...ENTRY, conclusion: "  ждать закрытия свечи " }, NOW)).toEqual({
      tradeDate: "2026-09-21",
      entryTime: "14:32",
      assetCode: "EURUSD_OTC",
      direction: "up",
      amountMinor: 800,
      payoutPercent: 90,
      expiryCode: "M3",
      result: "profit",
      plan: ENTRY.plan,
      planFollowed: null,
      violations: [],
      execution: null,
      conclusion: "ждать закрытия свечи",
    });
  });

  it("allows a trade with no written plan, which is itself worth recording", () => {
    expect(parseJournalManualEntry({ ...ENTRY, plan: "   " }, NOW).plan).toBeNull();
  });

  it("names the refused field", () => {
    expect(refusal(() => parseJournalManualEntry({ ...ENTRY, tradeDate: "2026-09-30" }, NOW))).toBe("invalid_tradeDate");
    expect(refusal(() => parseJournalManualEntry({ ...ENTRY, asset: "NOPE" }, NOW))).toBe("invalid_asset");
    expect(refusal(() => parseJournalManualEntry({ ...ENTRY, expiry: "M2" }, NOW))).toBe("invalid_expiry");
    expect(refusal(() => parseJournalManualEntry({ ...ENTRY, amount: "0" }, NOW))).toBe("invalid_amount");
    expect(refusal(() => parseJournalManualEntry({ ...ENTRY, result: "draw" }, NOW))).toBe("invalid_result");
    expect(refusal(() => parseJournalManualEntry({ ...ENTRY, entryTime: "9:30" }, NOW))).toBe("invalid_entryTime");
    expect(refusal(() => parseJournalManualEntry({ ...ENTRY, userId: 7 }, NOW))).toBe("invalid_entry");
  });

  it("records broken rules only against a broken plan, from the fixed list, in list order", () => {
    const entry = parseJournalManualEntry(
      { ...ENTRY, planFollowed: false, violations: ["tired", "revenge", "revenge"] },
      NOW,
    );
    expect(entry.violations).toEqual(["revenge", "tired"]);
    expect(refusal(() => parseJournalManualEntry({ ...ENTRY, planFollowed: true, violations: ["revenge"] }, NOW))).toBe(
      "invalid_violations",
    );
    expect(refusal(() => parseJournalManualEntry({ ...ENTRY, planFollowed: false, violations: ["gut_feeling"] }, NOW))).toBe(
      "invalid_violations",
    );
  });
});

describe("parseJournalChange", () => {
  it("edits the review of any entry", () => {
    expect(parseJournalChange({ kind: "review", planFollowed: false, violations: ["no_reason"], execution: " x " })).toEqual({
      kind: "review",
      review: { planFollowed: false, violations: ["no_reason"], execution: "x", conclusion: null },
    });
  });

  it("replaces a hand-recorded entry whole", () => {
    const change = parseJournalChange({ kind: "manual", ...ENTRY }, NOW);
    expect(change.kind).toBe("manual");
  });

  it("refuses anything else", () => {
    expect(refusal(() => parseJournalChange({ kind: "delete" }))).toBe("invalid_change");
    expect(refusal(() => parseJournalChange({ kind: "review", asset: "EURUSD_OTC" }))).toBe("invalid_change");
    expect(refusal(() => parseJournalChange(null))).toBe("invalid_change");
  });
});

describe("parseJournalQuery", () => {
  it("accepts the two named parameters and nothing else", () => {
    expect(parseJournalQuery(new URLSearchParams(""))).toEqual({ filter: "all", before: null });
    expect(parseJournalQuery(new URLSearchParams("filter=violated&before=cm3k9x2p10000abc"))).toEqual({
      filter: "violated",
      before: "cm3k9x2p10000abc",
    });
    expect(refusal(() => parseJournalQuery(new URLSearchParams("filter=best")))).toBe("invalid_filter");
    expect(refusal(() => parseJournalQuery(new URLSearchParams("before=../x")))).toBe("invalid_before");
    expect(refusal(() => parseJournalQuery(new URLSearchParams("userId=7")))).toBe("unexpected_query_parameter");
  });
});

describe("the Trade Card save carries the learner's date", () => {
  it("accepts a plausible date and refuses an impossible one", () => {
    const change = parseTradeCardChange({ action: "save", result: "loss", tradeDate: "2026-09-21" }, NOW);
    expect(change).toMatchObject({ action: "save", tradeDate: "2026-09-21" });
    expect(parseTradeCardChange({ action: "save", result: "loss" }, NOW)).toMatchObject({ tradeDate: null });
    expect(() => parseTradeCardChange({ action: "save", result: "loss", tradeDate: "2031-01-01" }, NOW)).toThrow(ToolError);
  });
});

describe("toJournalEntryDto", () => {
  const row: JournalRow = {
    id: "cljournal000001",
    userId: 42,
    source: "manual",
    tradeCardId: null,
    tradeDate: "2026-09-21",
    entryTime: "14:32",
    assetCode: "EURUSD_OTC",
    direction: "down",
    amountMinor: 1600,
    payoutPercent: 90,
    expiryCode: "M1",
    result: "loss",
    plan: null,
    execution: "Вход через минуту после убытка, сумма удвоена.",
    conclusion: null,
    planFollowed: false,
    createdAt: new Date("2026-09-21T12:33:00.000Z"),
    updatedAt: new Date("2026-09-21T12:40:00.000Z"),
    violations: [{ code: "tired" }, { code: "revenge" }],
  };

  it("states the money of this one trade and the rules in list order", () => {
    const dto = toJournalEntryDto(row);
    expect(dto.resultAmount).toBe("16.00");
    expect(toJournalEntryDto({ ...row, result: "profit" }).resultAmount).toBe("14.40");
    expect(dto.violations).toEqual(["revenge", "tired"]);
    expect(dto.asset.label).toBe("EUR/USD OTC");
    expect(JSON.stringify(dto)).not.toContain("userId");
  });

  it("carries a saved card's trade, reason and observation", () => {
    const card = {
      id: "clcard00000001",
      userId: 42,
      status: "saved",
      assetCode: "EURUSD_OTC",
      direction: "up",
      amountMinor: 800,
      payoutPercent: 90,
      expiryCode: "M3",
      entryTime: "14:32",
      reason: "Отскок",
      fixedAt: new Date(),
      planRevisionCount: 0,
      result: "profit",
      observation: "Вошёл по плану",
      savedAt: new Date(),
      cancelledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ToolTradeCard;
    expect(tradeFromCard(card, "2026-09-21")).toMatchObject({ plan: "Отскок", conclusion: "Вошёл по плану", result: "profit" });
  });

  it("has a code and a label for every rule", () => {
    expect(new Set(JOURNAL_VIOLATIONS.map((violation) => violation.code)).size).toBe(JOURNAL_VIOLATIONS.length);
  });
});
