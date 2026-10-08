import { describe, expect, it } from "vitest";
import {
  draftFromCard,
  draftOutcomes,
  emptyDraft,
  fieldOfServerDetail,
  formatMinor,
  gainLabel,
  lossLabel,
  outcomesFor,
  parseAmountToMinor,
  savedSummary,
  tradeCardStep,
  tradeWindow,
  validateDraft,
  type TradeCard,
  type TradeCardDraft,
  type TradeCardReference,
} from "./trade-card-model";

const REFERENCE: TradeCardReference = {
  assets: [
    { code: "EURUSD_OTC", label: "EUR/USD OTC", group: "currency_otc" },
    { code: "XAUUSD_OTC", label: "Gold OTC", group: "commodity_otc" },
  ],
  expiries: [
    { code: "M1", label: "1 мин", seconds: 60 },
    { code: "M3", label: "3 мин", seconds: 180 },
  ],
};

const DRAFT: TradeCardDraft = {
  asset: "EURUSD_OTC",
  direction: "up",
  amount: "8",
  payoutPercent: "90",
  expiry: "M3",
  entryTime: "14:32",
  reason: "  Цена вернулась к уровню поддержки.  ",
};

const CARD: TradeCard = {
  id: "cm3k9x2p10000abcdefghij",
  status: "fixed",
  plan: {
    asset: { code: "EURUSD_OTC", label: "EUR/USD OTC" },
    direction: "down",
    amount: "8.50",
    payoutPercent: 92,
    expiry: { code: "M3", label: "3 мин", seconds: 180 },
    entryTime: "14:32",
    reason: "Отбой от сопротивления",
  },
  outcomes: { ifRight: "7.82", ifWrong: "8.50" },
  fixedAt: "2026-09-21T11:30:00.000Z",
  planRevisionCount: 0,
  result: null,
  observation: null,
  savedAt: null,
  cancelledAt: null,
  createdAt: "2026-09-21T11:29:00.000Z",
};

describe("the stake", () => {
  it("reads whole and decimal amounts, with a dot or a comma", () => {
    expect(parseAmountToMinor("8")).toBe(800);
    expect(parseAmountToMinor("8.5")).toBe(850);
    expect(parseAmountToMinor("8,50")).toBe(850);
    expect(parseAmountToMinor(" 0.01 ")).toBe(1);
    expect(parseAmountToMinor("1000000")).toBe(100_000_000);
  });

  it("refuses what is not one positive stake within the limit", () => {
    for (const raw of ["", "0", "0.00", "-1", "1.234", "abc", "1 000", "1000000.01", "12345678", "8$"]) {
      expect(parseAmountToMinor(raw), raw).toBeNull();
    }
  });

  it("formats cents back to the Backend's shape", () => {
    expect(formatMinor(720)).toBe("7.20");
    expect(formatMinor(5)).toBe("0.05");
  });
});

describe("the two outcomes", () => {
  it("match the presentation: $8 at 90% is +$7.20 / −$8.00", () => {
    expect(outcomesFor(800, 90)).toEqual({ ifRightMinor: 720, ifWrongMinor: 800 });
    expect(draftOutcomes({ amount: "8", payoutPercent: "90" })).toEqual({ ifRight: "7.20", ifWrong: "8.00" });
    expect(gainLabel("7.20")).toBe("+$7.20");
    expect(lossLabel("8.00")).toBe("−$8.00");
  });

  it("round to a cent exactly as the Backend does", () => {
    expect(outcomesFor(850, 92)).toEqual({ ifRightMinor: 782, ifWrongMinor: 850 });
  });

  it("stay empty until both the stake and the payout are valid", () => {
    expect(draftOutcomes({ amount: "", payoutPercent: "90" })).toBeNull();
    expect(draftOutcomes({ amount: "8", payoutPercent: "0" })).toBeNull();
    expect(draftOutcomes({ amount: "8", payoutPercent: "101" })).toBeNull();
  });

  it("take a payout from 20 to 99 and no other", () => {
    expect(draftOutcomes({ amount: "8", payoutPercent: "20" })).toEqual({ ifRight: "1.60", ifWrong: "8.00" });
    expect(draftOutcomes({ amount: "8", payoutPercent: "99" })).toEqual({ ifRight: "7.92", ifWrong: "8.00" });
    for (const payoutPercent of ["19", "100", "9", "90%", "9.5"]) {
      expect(draftOutcomes({ amount: "8", payoutPercent }), payoutPercent).toBeNull();
    }
  });
});

describe("validateDraft", () => {
  it("turns a good draft into the Backend's plan", () => {
    expect(validateDraft({ ...DRAFT, amount: "8,5", payoutPercent: "90" }, REFERENCE)).toEqual({
      ok: true,
      plan: {
        asset: "EURUSD_OTC",
        direction: "up",
        amount: "8.50",
        payoutPercent: 90,
        expiry: "M3",
        entryTime: "14:32",
        reason: "Цена вернулась к уровню поддержки.",
      },
    });
  });

  it("names every missing field at once", () => {
    const checked = validateDraft(emptyDraft(new Date(2026, 8, 21, 9, 5)), REFERENCE);
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(Object.keys(checked.errors).sort()).toEqual(["amount", "asset", "direction", "expiry", "payoutPercent", "reason"]);
    }
  });

  it("refuses values outside the lists and the formats", () => {
    const bad = validateDraft(
      { ...DRAFT, asset: "EURUSD_FAKE", expiry: "M2", entryTime: "24:00", payoutPercent: "90.5", reason: " ab " },
      REFERENCE,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["asset", "entryTime", "expiry", "payoutPercent", "reason"]);
  });

  it("refuses a reason longer than the Backend keeps", () => {
    const long = validateDraft({ ...DRAFT, reason: "x".repeat(1001) }, REFERENCE);
    expect(long.ok).toBe(false);
  });
});

describe("drafts", () => {
  it("start blank, at the current minute", () => {
    expect(emptyDraft(new Date(2026, 8, 21, 9, 5))).toEqual({
      asset: "",
      direction: "",
      amount: "",
      payoutPercent: "",
      expiry: "",
      entryTime: "09:05",
      reason: "",
    });
  });

  it("re-open a fixed plan for «Изменить план»", () => {
    expect(draftFromCard(CARD)).toEqual({
      asset: "EURUSD_OTC",
      direction: "down",
      amount: "8.50",
      payoutPercent: "92",
      expiry: "M3",
      entryTime: "14:32",
      reason: "Отбой от сопротивления",
    });
  });
});

describe("server field errors", () => {
  it("map back onto the form", () => {
    expect(fieldOfServerDetail("invalid_amount")).toBe("amount");
    expect(fieldOfServerDetail("invalid_payoutPercent")).toBe("payoutPercent");
    expect(fieldOfServerDetail("invalid_entryTime")).toBe("entryTime");
    expect(fieldOfServerDetail("invalid_plan")).toBeNull();
    expect(fieldOfServerDetail(null)).toBeNull();
  });
});

describe("the steps follow the learner's clock", () => {
  const at = (h: number, m: number, s = 0) => new Date(2026, 8, 21, h, m, s);

  it("is preparation until a plan is fixed", () => {
    expect(tradeCardStep(null, at(14, 0), null)).toBe(0);
    expect(tradeCardStep({ ...CARD, status: "saved" }, at(14, 0), null)).toBe(0);
  });

  it("opens, runs to expiry, then asks for the result", () => {
    expect(tradeCardStep(CARD, at(14, 31), null)).toBe(1);
    expect(tradeCardStep(CARD, at(14, 33), null)).toBe(2);
    expect(tradeCardStep(CARD, at(14, 35, 1), null)).toBe(3);
  });

  it("moves to the review once a result is picked", () => {
    expect(tradeCardStep(CARD, at(14, 33), "profit")).toBe(4);
  });

  it("reads a time far ahead as yesterday's", () => {
    const window = tradeWindow("23:58", 180, at(0, 2))!;
    expect(window.opensAt.getDate()).toBe(20);
    expect(window.expiresAt.getTime() - window.opensAt.getTime()).toBe(180_000);
  });

  it("refuses a malformed time", () => {
    expect(tradeWindow("9:30", 60, at(9, 0))).toBeNull();
  });
});

describe("savedSummary", () => {
  it("words the saved card as the presentation does", () => {
    expect(savedSummary({ result: "profit", observation: null })).toBe("Прибыль · без наблюдения");
    expect(savedSummary({ result: "loss", observation: "вошёл рано" })).toBe("Убыток · с наблюдением");
  });
});
