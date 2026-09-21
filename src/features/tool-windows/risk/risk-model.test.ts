import { describe, expect, it } from "vitest";
import {
  capitalWords,
  draftInputs,
  draftMatchesPlan,
  draftOfPlan,
  emptyRiskDraft,
  gainMoney,
  losingTradesWords,
  lossMoney,
  money,
  numbersOfPlan,
  percent,
  riskFieldOfServerDetail,
  riskNumbers,
  stepsWords,
  validateRiskDraft,
  versionTime,
  type RiskDraft,
  type RiskPlan,
} from "./risk-model";

const SHARES = [1, 2, 3, 5];
const DRAFT: RiskDraft = {
  capital: "400",
  payoutPercent: "90",
  riskPercent: "2",
  dailyLimitPercent: "6",
  scenario: " Работаю только отскоки от уровней, отмеченных до начала сессии. ",
  cancelCondition: "Рядом с ценой нет отмеченного уровня или payout ниже 85%.",
};
const PLAN: RiskPlan = {
  id: "cmrisk00000000abcdefghij",
  version: 2,
  capital: "400.00",
  payoutPercent: 90,
  riskPercent: 2,
  dailyLimitPercent: 6,
  scenario: "Работаю только отскоки от уровней, отмеченных до начала сессии.",
  cancelCondition: "Рядом с ценой нет отмеченного уровня или payout ниже 85%.",
  createdAt: "2026-09-21T16:40:00.000Z",
  numbers: {
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
  },
};

describe("the arithmetic — the same as the Backend's, to the cent", () => {
  it("reproduces the presentation's example", () => {
    const numbers = riskNumbers({ capitalMinor: 40_000, payoutPercent: 90, riskPercent: 2, dailyLimitPercent: 6 });
    expect(numbers).toEqual(numbersOfPlan(PLAN));
  });

  it("says when doubling outruns the capital, and when one trade passes the limit", () => {
    const numbers = riskNumbers({ capitalMinor: 40_000, payoutPercent: 90, riskPercent: 5, dailyLimitPercent: 3 });
    expect(numbers.streak.doublingTradesCovered).toBe(4);
    expect(numbers.streak.doublingShareBasisPoints).toBe(15_500);
    expect(numbers.lossesToStop).toBe(0);
  });

  it("reads the Backend's figures back even past the input limits", () => {
    const big = { ...PLAN, numbers: { ...PLAN.numbers, streak: { ...PLAN.numbers.streak, doublingLoss: "1550000.00" } } };
    expect(numbersOfPlan(big).streak.doublingLossMinor).toBe(155_000_000);
  });
});

describe("the words", () => {
  it("writes money with cents, and groups thousands from 10 000", () => {
    expect(money(800)).toBe("$8.00");
    expect(money(123_456)).toBe("$1234.56");
    expect(money(2_400_000)).toBe("$24\u202f000.00");
    expect(gainMoney(720)).toBe("+$7.20");
    expect(lossMoney(24_800)).toBe("−$248.00");
  });

  it("says the capital the way a person does", () => {
    expect(capitalWords(40_000)).toBe("$400");
    expect(capitalWords(40_050)).toBe("$400.50");
    expect(capitalWords(2_500_000)).toBe("$25\u202f000");
  });

  it("lists the doubled amounts without empty cents", () => {
    expect(stepsWords([800, 1600, 3200, 6400, 12_800])).toBe("8 + 16 + 32 + 64 + 128");
    expect(stepsWords([850, 1700])).toBe("8.50 + 17");
  });

  it("writes a share with one decimal at most", () => {
    expect(percent(5263)).toBe("52.6%");
    expect(percent(1000)).toBe("10%");
    expect(percent(6200)).toBe("62%");
    expect(percent(15_500)).toBe("155%");
    expect(percent(5000)).toBe("50%");
  });

  it("counts losing trades in Russian", () => {
    expect(losingTradesWords(1)).toBe("1 убыточная сделка");
    expect(losingTradesWords(3)).toBe("3 убыточные сделки");
    expect(losingTradesWords(5)).toBe("5 убыточных сделок");
    expect(losingTradesWords(21)).toBe("21 убыточная сделка");
  });

  it("dates a version on the learner's clock, with the year only when it differs", () => {
    const at = new Date(2026, 8, 21, 18, 40).toISOString();
    expect(versionTime(at, new Date(2026, 8, 22))).toBe("21 сентября, 18:40");
    expect(versionTime(at, new Date(2027, 0, 2))).toBe("21 сентября 2026, 18:40");
    expect(versionTime("not a date", new Date())).toBe("");
  });
});

describe("the form", () => {
  it("starts empty: the numbers are the learner's own", () => {
    expect(emptyRiskDraft()).toEqual({
      capital: "",
      payoutPercent: "",
      riskPercent: "",
      dailyLimitPercent: "",
      scenario: "",
      cancelCondition: "",
    });
    expect(draftInputs(emptyRiskDraft(), SHARES)).toBeNull();
  });

  it("computes as soon as the four numbers are valid, the texts aside", () => {
    expect(draftInputs({ ...DRAFT, scenario: "", cancelCondition: "" }, SHARES)).toEqual({
      capitalMinor: 40_000,
      payoutPercent: 90,
      riskPercent: 2,
      dailyLimitPercent: 6,
    });
    expect(draftInputs({ ...DRAFT, capital: "0.5" }, SHARES)).toBeNull();
    expect(draftInputs({ ...DRAFT, riskPercent: "4" }, SHARES)).toBeNull();
    expect(draftInputs({ ...DRAFT, capital: "400,50" }, SHARES)?.capitalMinor).toBe(40_050);
  });

  it("becomes exactly what the Backend accepts", () => {
    expect(validateRiskDraft(DRAFT, SHARES)).toEqual({
      ok: true,
      plan: {
        capital: "400.00",
        payoutPercent: 90,
        riskPercent: 2,
        dailyLimitPercent: 6,
        scenario: "Работаю только отскоки от уровней, отмеченных до начала сессии.",
        cancelCondition: "Рядом с ценой нет отмеченного уровня или payout ниже 85%.",
      },
    });
  });

  it("names every problem at once", () => {
    const result = validateRiskDraft(emptyRiskDraft(), SHARES);
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(
      ["cancelCondition", "capital", "dailyLimitPercent", "payoutPercent", "riskPercent", "scenario"].sort(),
    );
    const big = validateRiskDraft({ ...DRAFT, capital: "1000000.01", dailyLimitPercent: "0" }, SHARES);
    expect(!big.ok && Object.keys(big.errors).sort()).toEqual(["capital", "dailyLimitPercent"]);
  });

  it("holds the plan in force, and knows when it no longer says the same", () => {
    const draft = draftOfPlan(PLAN);
    expect(draft).toMatchObject({ capital: "400", payoutPercent: "90", riskPercent: "2", dailyLimitPercent: "6" });
    expect(draftMatchesPlan(draft, PLAN, SHARES)).toBe(true);
    expect(draftMatchesPlan({ ...draft, capital: "400.00" }, PLAN, SHARES)).toBe(true);
    expect(draftMatchesPlan({ ...draft, scenario: `${draft.scenario} ` }, PLAN, SHARES)).toBe(true);
    expect(draftMatchesPlan({ ...draft, riskPercent: "1" }, PLAN, SHARES)).toBe(false);
    expect(draftMatchesPlan({ ...draft, capital: "" }, PLAN, SHARES)).toBe(false);
  });

  it("maps the Backend's refused field onto the form", () => {
    expect(riskFieldOfServerDetail("invalid_capital")).toBe("capital");
    expect(riskFieldOfServerDetail("invalid_cancelCondition")).toBe("cancelCondition");
    expect(riskFieldOfServerDetail("invalid_plan")).toBeNull();
    expect(riskFieldOfServerDetail(null)).toBeNull();
  });
});
