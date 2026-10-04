import { describe, expect, it } from "vitest";
import type { ToolTradeCard } from "@prisma/client";
import { ToolError } from "./errors";
import {
  formatMinor,
  parseAmountToMinor,
  parseTradeCardChange,
  parseTradeCardPlan,
  toTradeCardDto,
  tradeCardOutcomes,
} from "./trade-card";

const PLAN = {
  asset: "EURUSD_OTC",
  direction: "up",
  amount: "8",
  payoutPercent: 90,
  expiry: "M3",
  entryTime: "14:32",
  reason: "Цена вернулась к уровню поддержки, отмеченному до сессии.",
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

describe("amount in minor units", () => {
  it("parses whole and decimal stakes", () => {
    expect(parseAmountToMinor("8")).toBe(800);
    expect(parseAmountToMinor("8.5")).toBe(850);
    expect(parseAmountToMinor("8.50")).toBe(850);
    expect(parseAmountToMinor(" 0.01 ")).toBe(1);
    expect(parseAmountToMinor("1000000.00")).toBe(100_000_000);
  });

  it("refuses what is not a single positive stake", () => {
    for (const raw of ["0", "0.00", "-1", "1.234", "1,5", "abc", "", "1000000.01", "12345678"]) {
      expect(parseAmountToMinor(raw), raw).toBeNull();
    }
  });

  it("formats minor units with two decimals", () => {
    expect(formatMinor(720)).toBe("7.20");
    expect(formatMinor(5)).toBe("0.05");
    expect(formatMinor(100_000_000)).toBe("1000000.00");
  });
});

describe("the two outcomes of one trade", () => {
  it("matches the presentation: $8 at 90% is +$7.20 / -$8.00", () => {
    expect(tradeCardOutcomes(800, 90)).toEqual({ ifRightMinor: 720, ifWrongMinor: 800 });
  });

  it("rounds half-up to a cent", () => {
    expect(tradeCardOutcomes(850, 92)).toEqual({ ifRightMinor: 782, ifWrongMinor: 850 });
    expect(tradeCardOutcomes(1, 85)).toEqual({ ifRightMinor: 1, ifWrongMinor: 1 });
  });
});

describe("parseTradeCardPlan", () => {
  it("accepts the presentation's plan", () => {
    expect(parseTradeCardPlan(PLAN)).toEqual({
      assetCode: "EURUSD_OTC",
      direction: "up",
      amountMinor: 800,
      payoutPercent: 90,
      expiryCode: "M3",
      entryTime: "14:32",
      reason: PLAN.reason,
    });
  });

  it("trims the reason", () => {
    expect(parseTradeCardPlan({ ...PLAN, reason: "  отскок  " }).reason).toBe("отскок");
  });

  it("names the refused field", () => {
    expect(refusal(() => parseTradeCardPlan({ ...PLAN, asset: "EURUSD_FAKE" }))).toBe("invalid_asset");
    expect(refusal(() => parseTradeCardPlan({ ...PLAN, expiry: "M2" }))).toBe("invalid_expiry");
    expect(refusal(() => parseTradeCardPlan({ ...PLAN, amount: "0" }))).toBe("invalid_amount");
    expect(refusal(() => parseTradeCardPlan({ ...PLAN, reason: " ab " }))).toBe("invalid_reason");
    expect(refusal(() => parseTradeCardPlan({ ...PLAN, entryTime: "24:00" }))).toBe("invalid_entryTime");
    expect(refusal(() => parseTradeCardPlan({ ...PLAN, entryTime: "9:30" }))).toBe("invalid_entryTime");
    expect(refusal(() => parseTradeCardPlan({ ...PLAN, payoutPercent: 0 }))).toBe("invalid_payoutPercent");
    expect(refusal(() => parseTradeCardPlan({ ...PLAN, payoutPercent: 101 }))).toBe("invalid_payoutPercent");
    // A payout is 20…99 (owner, 2026-10-02): the edges are in, their neighbours are out.
    expect(refusal(() => parseTradeCardPlan({ ...PLAN, payoutPercent: 19 }))).toBe("invalid_payoutPercent");
    expect(refusal(() => parseTradeCardPlan({ ...PLAN, payoutPercent: 100 }))).toBe("invalid_payoutPercent");
    expect(parseTradeCardPlan({ ...PLAN, payoutPercent: 20 }).payoutPercent).toBe(20);
    expect(parseTradeCardPlan({ ...PLAN, payoutPercent: 99 }).payoutPercent).toBe(99);
    expect(refusal(() => parseTradeCardPlan({ ...PLAN, payoutPercent: 90.5 }))).toBe("invalid_payoutPercent");
    expect(refusal(() => parseTradeCardPlan({ ...PLAN, direction: "sideways" }))).toBe("invalid_direction");
  });

  it("refuses unknown fields and non-objects", () => {
    expect(refusal(() => parseTradeCardPlan({ ...PLAN, userId: 7 }))).toBe("invalid_plan");
    expect(refusal(() => parseTradeCardPlan(null))).toBe("invalid_plan");
    expect(refusal(() => parseTradeCardPlan("plan"))).toBe("invalid_plan");
  });
});

describe("parseTradeCardChange", () => {
  it("re-fixes with a validated plan", () => {
    const change = parseTradeCardChange({ action: "refix", plan: { ...PLAN, direction: "down" } });
    expect(change.action).toBe("refix");
    if (change.action === "refix") expect(change.plan.direction).toBe("down");
  });

  it("saves a result with an optional, trimmed observation", () => {
    expect(parseTradeCardChange({ action: "save", result: "profit", observation: "  урок  " })).toEqual({
      action: "save",
      result: "profit",
      observation: "урок",
      tradeDate: null,
    });
    expect(parseTradeCardChange({ action: "save", result: "loss", observation: "   " })).toEqual({
      action: "save",
      result: "loss",
      observation: null,
      tradeDate: null,
    });
    expect(parseTradeCardChange({ action: "save", result: "loss" })).toEqual({
      action: "save",
      result: "loss",
      observation: null,
      tradeDate: null,
    });
  });

  it("cancels", () => {
    expect(parseTradeCardChange({ action: "cancel" })).toEqual({ action: "cancel" });
  });

  it("refuses an unknown action, a missing result and extra fields", () => {
    expect(refusal(() => parseTradeCardChange({ action: "delete" }))).toBe("invalid_change");
    expect(refusal(() => parseTradeCardChange({ action: "save" }))).toBe("invalid_change");
    expect(refusal(() => parseTradeCardChange({ action: "save", result: "draw" }))).toBe("invalid_change");
    expect(refusal(() => parseTradeCardChange({ action: "cancel", status: "saved" }))).toBe("invalid_change");
  });

  it("refuses a refix whose plan is invalid, naming the field", () => {
    expect(refusal(() => parseTradeCardChange({ action: "refix", plan: { ...PLAN, amount: "-3" } }))).toBe(
      "invalid_amount",
    );
  });
});

describe("toTradeCardDto", () => {
  const row: ToolTradeCard = {
    id: "clabc12345xyz",
    userId: 42,
    status: "fixed",
    assetCode: "EURUSD_OTC",
    direction: "up",
    amountMinor: 800,
    payoutPercent: 90,
    expiryCode: "M3",
    entryTime: "14:32",
    reason: "отскок от уровня",
    fixedAt: new Date("2026-09-21T14:32:00.000Z"),
    planRevisionCount: 0,
    result: null,
    observation: null,
    savedAt: null,
    cancelledAt: null,
    createdAt: new Date("2026-09-21T14:31:00.000Z"),
    updatedAt: new Date("2026-09-21T14:32:00.000Z"),
  };

  it("names the asset and expiry and projects both outcomes", () => {
    const dto = toTradeCardDto(row);
    expect(dto.plan.asset).toEqual({ code: "EURUSD_OTC", label: "EUR/USD OTC" });
    expect(dto.plan.expiry).toEqual({ code: "M3", label: "3 мин", seconds: 180 });
    expect(dto.plan.amount).toBe("8.00");
    expect(dto.outcomes).toEqual({ ifRight: "7.20", ifWrong: "8.00" });
    expect(dto.fixedAt).toBe("2026-09-21T14:32:00.000Z");
    expect(dto.result).toBeNull();
  });

  it("never exposes the owner", () => {
    expect(JSON.stringify(toTradeCardDto(row))).not.toContain("userId");
  });

  it("still renders a card whose codes were later withdrawn", () => {
    const dto = toTradeCardDto({ ...row, assetCode: "OLD_ASSET", expiryCode: "X9" });
    expect(dto.plan.asset.label).toBe("OLD_ASSET");
    expect(dto.plan.expiry).toEqual({ code: "X9", label: "X9", seconds: 0 });
  });
});
