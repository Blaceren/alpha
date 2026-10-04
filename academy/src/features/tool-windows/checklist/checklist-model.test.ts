import { describe, expect, it } from "vitest";
import {
  checklistFieldOfServerDetail,
  checklistVerdict,
  emptyChecklistDraft,
  itemLabel,
  parseMinPayout,
  validateChecklistDraft,
  verdictLine,
  verdictWords,
  type ChecklistItem,
  type EntryCheck,
} from "./checklist-model";

const ITEMS: ChecklistItem[] = [
  { code: "no_news", group: "environment", stop: true, label: "Рядом нет важной новости (±15 мин)" },
  { code: "stable_connection", group: "environment", stop: true, label: "Связь стабильна" },
  { code: "payout_minimum", group: "environment", stop: false, label: "Payout не ниже моего минимума" },
  { code: "market_state", group: "setup", stop: false, label: "Состояние рынка определено: тренд или боковик" },
  { code: "price_at_zone", group: "setup", stop: false, label: "Цена у зоны, отмеченной до сессии" },
  { code: "setup_conditions", group: "setup", stop: false, label: "Все условия моего setup выполнены" },
  { code: "daily_limit", group: "state", stop: true, label: "Дневной лимит не достигнут" },
  { code: "no_revenge", group: "state", stop: true, label: "Нет желания отыграться" },
  { code: "attention", group: "state", stop: false, label: "Внимание на графике, не устал" },
];
const ALL = Object.fromEntries(ITEMS.map((item) => [item.code, true]));
const without = (...codes: string[]) => ({ ...ALL, ...Object.fromEntries(codes.map((code) => [code, false])) });
const STATE = {
  checklist: { groups: [], items: ITEMS },
  reference: { assets: [{ code: "EURUSD_OTC", label: "EUR/USD OTC", group: "currency_otc" }] },
  lastMinPayoutPercent: 85,
};

describe("the verdict — the Backend's rule", () => {
  it("allows the entry only with all nine confirmed", () => {
    expect(checklistVerdict(ITEMS, ALL)).toEqual({ verdict: "enter", missingItem: null });
  });

  it("puts any open stop factor first, then names the first open condition", () => {
    expect(checklistVerdict(ITEMS, without("payout_minimum", "no_revenge")).missingItem?.code).toBe("no_revenge");
    expect(checklistVerdict(ITEMS, without("payout_minimum", "no_revenge")).verdict).toBe("skip_stop");
    expect(checklistVerdict(ITEMS, without("attention", "price_at_zone"))).toEqual({
      verdict: "skip_condition",
      missingItem: ITEMS[4],
    });
    expect(checklistVerdict(ITEMS, {}).missingItem?.code).toBe("no_news");
  });

  it("speaks in the presentation's words", () => {
    expect(verdictWords("enter", null)).toEqual({
      title: "Вход по плану допустим",
      body: "Все условия выполнены. Решение и сумму вы подтверждаете сами.",
    });
    expect(verdictWords("skip_stop", "Связь стабильна")).toEqual({
      title: "Не входить: стоп-фактор",
      body: "Не отмечено: «Связь стабильна». Отказ от сделки — полноценное решение.",
    });
    expect(verdictWords("skip_condition", "Цена у зоны, отмеченной до сессии").title).toBe(
      "Не входить: условие не выполнено",
    );
  });
});

describe("the words around it", () => {
  it("adds the learner's minimum to the payout item only", () => {
    expect(itemLabel(ITEMS[2]!, 85)).toBe("Payout не ниже моего минимума — 85%");
    expect(itemLabel(ITEMS[2]!, null)).toBe("Payout не ниже моего минимума");
    expect(itemLabel(ITEMS[0]!, 85)).toBe("Рядом нет важной новости (±15 мин)");
  });

  it("sums a kept check up in one line", () => {
    const check = (verdict: EntryCheck["verdict"], missingItem: string | null): EntryCheck => ({
      id: "cmcheck0000000abcdefghij",
      asset: { code: "EURUSD_OTC", label: "EUR/USD OTC" },
      minPayoutPercent: 80,
      answers: ALL,
      verdict,
      missingItem,
      createdAt: "2026-09-21T12:00:00.000Z",
    });
    expect(verdictLine(check("enter", null), ITEMS)).toBe("Вход допустим");
    expect(verdictLine(check("skip_stop", "no_news"), ITEMS)).toBe("Не входить · стоп-фактор: Рядом нет важной новости (±15 мин)");
    expect(verdictLine(check("skip_condition", "payout_minimum"), ITEMS)).toBe(
      "Не входить · условие: Payout не ниже моего минимума — 80%",
    );
  });
});

describe("the form", () => {
  it("starts with nothing ticked and the learner's last minimum", () => {
    const draft = emptyChecklistDraft(STATE);
    expect(draft.asset).toBe("");
    expect(draft.minPayoutPercent).toBe("85");
    expect(Object.values(draft.answers).every((answer) => answer === false)).toBe(true);
    expect(emptyChecklistDraft({ ...STATE, lastMinPayoutPercent: null }).minPayoutPercent).toBe("");
  });

  it("reads the minimum as empty, a payout from 20 to 99, or not valid", () => {
    expect(parseMinPayout("")).toBeNull();
    expect(parseMinPayout("  ")).toBeNull();
    expect(parseMinPayout("85")).toBe(85);
    expect(parseMinPayout("20")).toBe(20);
    expect(parseMinPayout("99")).toBe(99);
    for (const raw of ["0", "19", "100", "85.5", "85%", "8a"]) expect(parseMinPayout(raw), raw).toBeUndefined();
  });

  it("sends exactly the nine answers, the asset and the minimum", () => {
    const result = validateChecklistDraft(
      { asset: "EURUSD_OTC", minPayoutPercent: "85", answers: { ...without("attention"), stray: true } },
      STATE,
    );
    expect(result).toEqual({
      ok: true,
      check: { asset: "EURUSD_OTC", minPayoutPercent: 85, answers: without("attention") },
    });
  });

  it("asks for the asset and a valid minimum, and nothing else", () => {
    const result = validateChecklistDraft({ asset: "", minPayoutPercent: "101", answers: {} }, STATE);
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(["asset", "minPayoutPercent"]);
    expect(validateChecklistDraft({ asset: "EURUSD_OTC", minPayoutPercent: "", answers: {} }, STATE).ok).toBe(true);
  });

  it("maps the Backend's refused field onto the form", () => {
    expect(checklistFieldOfServerDetail("invalid_asset")).toBe("asset");
    expect(checklistFieldOfServerDetail("invalid_minPayoutPercent")).toBe("minPayoutPercent");
    expect(checklistFieldOfServerDetail("invalid_answers")).toBeNull();
  });
});
