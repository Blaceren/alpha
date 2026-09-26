import { describe, expect, it } from "vitest";
import type { ToolRiskPlan } from "@prisma/client";
import { ToolError } from "./errors";
import { RISK_SHARES, isSamePlan, parseRiskPlan, riskNumbers, riskReference, toRiskPlanDto } from "./risk";

const PLAN = {
  capital: "400",
  payoutPercent: 90,
  riskPercent: 2,
  dailyLimitPercent: 6,
  scenario: "Работаю только отскоки от уровней, отмеченных до начала сессии.",
  cancelCondition: "Рядом с ценой нет отмеченного уровня или payout ниже 85%.",
};

function refused(input: unknown): string | null {
  try {
    parseRiskPlan(input);
    return null;
  } catch (error) {
    return error instanceof ToolError ? `${error.code}:${error.detail}` : "other";
  }
}

describe("riskNumbers — the presentation's own example", () => {
  const numbers = riskNumbers({ capitalMinor: 40_000, payoutPercent: 90, riskPercent: 2, dailyLimitPercent: 6 });

  it("sizes one trade at 2% of $400 and shows its two outcomes", () => {
    expect(numbers.tradeAmountMinor).toBe(800);
    expect(numbers.ifRightMinor).toBe(720);
    expect(numbers.ifWrongMinor).toBe(800);
  });

  it("turns a 6% daily limit into $24.00 and three losing trades", () => {
    expect(numbers.dailyLimitMinor).toBe(2400);
    expect(numbers.lossesToStop).toBe(3);
  });

  it("puts break-even at 1 / (1 + payout): 52.63% at 90%", () => {
    expect(numbers.breakEvenBasisPoints).toBe(5263);
    expect(riskNumbers({ capitalMinor: 40_000, payoutPercent: 100, riskPercent: 2, dailyLimitPercent: 6 }).breakEvenBasisPoints).toBe(5000);
  });

  it("prices five losses in a row: −$40.00 (10%) fixed, −$248.00 (62%) doubling", () => {
    expect(numbers.streak.length).toBe(5);
    expect(numbers.streak.fixedLossMinor).toBe(4000);
    expect(numbers.streak.fixedShareBasisPoints).toBe(1000);
    expect(numbers.streak.doublingStepsMinor).toEqual([800, 1600, 3200, 6400, 12_800]);
    expect(numbers.streak.doublingLossMinor).toBe(24_800);
    expect(numbers.streak.doublingShareBasisPoints).toBe(6200);
    expect(numbers.streak.doublingTradesCovered).toBe(5);
  });
});

describe("riskNumbers — the edges", () => {
  it("says when doubling outruns the capital: at 5% the fifth trade cannot be paid", () => {
    const numbers = riskNumbers({ capitalMinor: 40_000, payoutPercent: 90, riskPercent: 5, dailyLimitPercent: 10 });
    expect(numbers.streak.doublingLossMinor).toBe(62_000);
    expect(numbers.streak.doublingShareBasisPoints).toBe(15_500);
    expect(numbers.streak.doublingTradesCovered).toBe(4);
  });

  it("answers zero losing trades when one trade is already past the daily limit", () => {
    const numbers = riskNumbers({ capitalMinor: 40_000, payoutPercent: 90, riskPercent: 5, dailyLimitPercent: 3 });
    expect(numbers.tradeAmountMinor).toBe(2000);
    expect(numbers.dailyLimitMinor).toBe(1200);
    expect(numbers.lossesToStop).toBe(0);
  });

  it("rounds to a cent, half up", () => {
    const numbers = riskNumbers({ capitalMinor: 33_333, payoutPercent: 87, riskPercent: 3, dailyLimitPercent: 7 });
    expect(numbers.tradeAmountMinor).toBe(1000);
    expect(numbers.ifRightMinor).toBe(870);
    expect(numbers.dailyLimitMinor).toBe(2333);
    expect(numbers.lossesToStop).toBe(2);
  });

  it("keeps the smallest capital's trade at a cent", () => {
    expect(riskNumbers({ capitalMinor: 100, payoutPercent: 90, riskPercent: 1, dailyLimitPercent: 1 }).tradeAmountMinor).toBe(1);
  });
});

describe("parseRiskPlan", () => {
  it("accepts the presentation's plan, trimmed, in minor units", () => {
    expect(parseRiskPlan({ ...PLAN, capital: "400.00", scenario: `  ${PLAN.scenario}  ` })).toEqual({
      capitalMinor: 40_000,
      payoutPercent: 90,
      riskPercent: 2,
      dailyLimitPercent: 6,
      scenario: PLAN.scenario,
      cancelCondition: PLAN.cancelCondition,
    });
  });

  it("names the refused field", () => {
    expect(refused({ ...PLAN, capital: "0.99" })).toBe("TOOL_VALIDATION:invalid_capital");
    expect(refused({ ...PLAN, capital: "1000000.01" })).toBe("TOOL_VALIDATION:invalid_capital");
    expect(refused({ ...PLAN, capital: "-5" })).toBe("TOOL_VALIDATION:invalid_capital");
    expect(refused({ ...PLAN, capital: 400 })).toBe("TOOL_VALIDATION:invalid_capital");
    expect(refused({ ...PLAN, riskPercent: 4 })).toBe("TOOL_VALIDATION:invalid_riskPercent");
    expect(refused({ ...PLAN, riskPercent: 2.5 })).toBe("TOOL_VALIDATION:invalid_riskPercent");
    expect(refused({ ...PLAN, payoutPercent: 0 })).toBe("TOOL_VALIDATION:invalid_payoutPercent");
    expect(refused({ ...PLAN, dailyLimitPercent: 101 })).toBe("TOOL_VALIDATION:invalid_dailyLimitPercent");
    expect(refused({ ...PLAN, scenario: "  a " })).toBe("TOOL_VALIDATION:invalid_scenario");
    expect(refused({ ...PLAN, cancelCondition: "x".repeat(1001) })).toBe("TOOL_VALIDATION:invalid_cancelCondition");
    expect(refused({ ...PLAN, balance: "400" })).toMatch(/^TOOL_VALIDATION:invalid_/);
    expect(refused(null)).toBe("TOOL_VALIDATION:invalid_plan");
  });

  it("offers exactly the four shares the lessons teach", () => {
    expect([...RISK_SHARES]).toEqual([1, 2, 3, 5]);
    expect(riskReference()).toEqual({ riskShares: [1, 2, 3, 5], streakLength: 5 });
  });
});

describe("a saved version", () => {
  const row: ToolRiskPlan = {
    id: "cmrisk00000000abcdefghij",
    userId: 7,
    capitalMinor: 40_000,
    payoutPercent: 90,
    riskPercent: 2,
    dailyLimitPercent: 6,
    scenario: PLAN.scenario,
    cancelCondition: PLAN.cancelCondition,
    createdAt: new Date("2026-09-21T18:00:00.000Z"),
  };

  it("knows when a save would say nothing new", () => {
    const same = parseRiskPlan(PLAN);
    expect(isSamePlan(row, same)).toBe(true);
    expect(isSamePlan(row, { ...same, dailyLimitPercent: 5 })).toBe(false);
    expect(isSamePlan(row, { ...same, scenario: "Другой сценарий" })).toBe(false);
  });

  it("goes out with its inputs, its version and the plan's arithmetic as strings", () => {
    const dto = toRiskPlanDto(row, 3);
    expect(dto).toMatchObject({ version: 3, capital: "400.00", riskPercent: 2, createdAt: "2026-09-21T18:00:00.000Z" });
    expect(dto.numbers).toEqual({
      tradeAmount: "8.00",
      ifRight: "7.20",
      ifWrong: "8.00",
      dailyLimit: "24.00",
      lossesToStop: 3,
      breakEvenBasisPoints: 5263,
      streak: {
        length: 5,
        fixedLoss: "40.00",
        fixedShareBasisPoints: 1000,
        doublingSteps: ["8.00", "16.00", "32.00", "64.00", "128.00"],
        doublingLoss: "248.00",
        doublingShareBasisPoints: 6200,
        doublingTradesCovered: 5,
      },
    });
    expect(dto).not.toHaveProperty("userId");
  });
});
