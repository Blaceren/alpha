import { describe, expect, it } from "vitest";
import type { ToolEntryCheck } from "@prisma/client";
import { ToolError } from "./errors";
import {
  CHECKLIST_ITEMS,
  CHECKLIST_ITEMS_V1,
  CHECKLIST_VERSION,
  checklistItemsOfVersion,
  checklistReference,
  checklistVerdict,
  decodeAnswers,
  encodeAnswers,
  parseEntryCheck,
  toEntryCheckDto,
  type ChecklistAnswers,
  type ChecklistItemCode,
} from "./entry-checklist";

const ALL: ChecklistAnswers = Object.fromEntries(CHECKLIST_ITEMS.map((item) => [item.code, true])) as Record<
  ChecklistItemCode,
  boolean
>;
const without = (...codes: ChecklistItemCode[]): ChecklistAnswers => ({
  ...ALL,
  ...Object.fromEntries(codes.map((code) => [code, false])),
});

function refused(input: unknown): string | null {
  try {
    parseEntryCheck(input);
    return null;
  } catch (error) {
    return error instanceof ToolError ? `${error.code}:${error.detail}` : "other";
  }
}

describe("the fixed list", () => {
  it("is the owner's seven items of 2026-10-07 in three groups, none a stop factor", () => {
    expect(CHECKLIST_ITEMS.map((item) => item.code)).toEqual([
      "asset_in_list",
      "time_period",
      "payout_checked",
      "market_state",
      "area_named",
      "size_by_plan",
      "reason_in_words",
    ]);
    expect(CHECKLIST_ITEMS.map((item) => item.label)).toEqual([
      "Актив из моего списка",
      "Время — подходящий период",
      "Payout посмотрел, планку посчитал",
      "Состояние определено: тренд, боковик или неясно",
      "Область названа",
      "Размер по плану",
      "Основание сформулировано словами",
    ]);
    expect(CHECKLIST_ITEMS.filter((item) => item.stop)).toEqual([]);
    expect(checklistReference().groups.map((group) => group.label)).toEqual(["Среда", "График", "Сделка"]);
    expect(CHECKLIST_ITEMS.map((item) => item.group)).toEqual([
      "environment",
      "environment",
      "environment",
      "chart",
      "chart",
      "trade",
      "trade",
    ]);
    expect(CHECKLIST_VERSION).toBe(2);
  });

  it("keeps the first list, nine items with four stop factors, for the checks answered against it", () => {
    expect(CHECKLIST_ITEMS_V1).toHaveLength(9);
    expect(CHECKLIST_ITEMS_V1.filter((item) => item.stop).map((item) => item.code)).toEqual([
      "no_news",
      "stable_connection",
      "daily_limit",
      "no_revenge",
    ]);
    expect(checklistItemsOfVersion(1)).toBe(CHECKLIST_ITEMS_V1);
    expect(checklistItemsOfVersion(2)).toBe(CHECKLIST_ITEMS);
    expect(checklistItemsOfVersion(99)).toBe(CHECKLIST_ITEMS);
  });
});

describe("checklistVerdict", () => {
  it("allows the entry only when all seven are confirmed", () => {
    expect(checklistVerdict(ALL)).toEqual({ verdict: "enter", missingItem: null });
  });

  it("names the first unconfirmed condition, in the list's order", () => {
    expect(checklistVerdict(without("area_named", "reason_in_words"))).toEqual({
      verdict: "skip_condition",
      missingItem: "area_named",
    });
  });

  it("never says «стоп-фактор» for the seven: none is one", () => {
    const none = Object.fromEntries(CHECKLIST_ITEMS.map((item) => [item.code, false])) as unknown as ChecklistAnswers;
    expect(checklistVerdict(none)).toEqual({ verdict: "skip_condition", missingItem: "asset_in_list" });
  });
});

describe("answers as one character per item", () => {
  it("round-trips in the list's order", () => {
    const answers = without("market_state");
    expect(encodeAnswers(answers)).toBe("1110111");
    expect(decodeAnswers("1110111")).toEqual(answers);
  });

  it("reads the first list's nine characters by that list", () => {
    const decoded = decodeAnswers("110111111", 1);
    expect(Object.keys(decoded)).toEqual(CHECKLIST_ITEMS_V1.map((item) => item.code));
    expect(decoded.payout_minimum).toBe(false);
    expect(decoded.attention).toBe(true);
  });
});

describe("parseEntryCheck", () => {
  const body = { asset: "EURUSD", minPayoutPercent: 85, answers: ALL };

  it("accepts a check with and without a minimum payout", () => {
    expect(parseEntryCheck(body)).toEqual({ assetCode: "EURUSD", minPayoutPercent: 85, answers: ALL });
    expect(parseEntryCheck({ ...body, minPayoutPercent: null }).minPayoutPercent).toBeNull();
  });

  it("names the refused field, and refuses anything but the seven answers", () => {
    expect(refused({ ...body, asset: "DOGE" })).toBe("TOOL_VALIDATION:invalid_asset");
    expect(refused({ ...body, minPayoutPercent: 0 })).toBe("TOOL_VALIDATION:invalid_minPayoutPercent");
    // The learner's own minimum is a payout like any other: 20…99.
    expect(refused({ ...body, minPayoutPercent: 19 })).toBe("TOOL_VALIDATION:invalid_minPayoutPercent");
    expect(refused({ ...body, minPayoutPercent: 100 })).toBe("TOOL_VALIDATION:invalid_minPayoutPercent");
    expect(parseEntryCheck({ ...body, minPayoutPercent: 20 }).minPayoutPercent).toBe(20);
    expect(parseEntryCheck({ ...body, minPayoutPercent: 99 }).minPayoutPercent).toBe(99);
    expect(refused({ ...body, minPayoutPercent: 85.5 })).toBe("TOOL_VALIDATION:invalid_minPayoutPercent");
    expect(refused({ ...body, answers: { ...ALL, extra: true } })).toBe("TOOL_VALIDATION:invalid_answers");
    // The first list's answers are not the current list's.
    expect(refused({ ...body, answers: { ...ALL, no_news: true } })).toBe("TOOL_VALIDATION:invalid_answers");
    const missing: Record<string, boolean> = { ...ALL };
    delete missing.reason_in_words;
    expect(refused({ ...body, answers: missing })).toBe("TOOL_VALIDATION:invalid_answers");
    expect(refused({ ...body, answers: { ...ALL, reason_in_words: "yes" } })).toBe("TOOL_VALIDATION:invalid_answers");
    expect(refused({ ...body, verdict: "enter" })).toMatch(/^TOOL_VALIDATION:invalid_/);
    expect(refused(null)).toBe("TOOL_VALIDATION:invalid_check");
  });
});

describe("a kept check", () => {
  const row = (over: Partial<ToolEntryCheck>): ToolEntryCheck => ({
    id: "cmcheck0000000abcdefghij",
    userId: 7,
    assetCode: "EURUSD",
    minPayoutPercent: 85,
    listVersion: 2,
    answers: "1101111",
    verdict: "skip_condition",
    missingItem: "payout_checked",
    createdAt: new Date("2026-10-07T12:30:00.000Z"),
    ...over,
  });

  it("goes out with the asset's name, the answers by code, the server's verdict and the named item's words", () => {
    const dto = toEntryCheckDto(row({}));
    expect(dto).toMatchObject({
      asset: { code: "EURUSD", label: "EUR/USD" },
      minPayoutPercent: 85,
      listVersion: 2,
      verdict: "skip_condition",
      missingItem: "payout_checked",
      missingItemLabel: "Payout посмотрел, планку посчитал",
      createdAt: "2026-10-07T12:30:00.000Z",
    });
    expect(dto.answers.payout_checked).toBe(false);
    expect(dto.answers.asset_in_list).toBe(true);
    expect(dto).not.toHaveProperty("userId");
  });

  it("reads a check of the first list as it was: nine answers, its own item named in its own words", () => {
    const dto = toEntryCheckDto(
      row({ assetCode: "EURUSD_OTC", listVersion: 1, answers: "110111101", verdict: "skip_stop", missingItem: "no_revenge" }),
    );
    expect(dto.listVersion).toBe(1);
    expect(Object.keys(dto.answers)).toHaveLength(9);
    expect(dto.answers.no_revenge).toBe(false);
    expect(dto.answers.payout_minimum).toBe(false);
    expect(dto.missingItemLabel).toBe("Нет желания отыграться");
    expect(dto.asset.label).toBe("EUR/USD OTC");
  });

  it("names nothing for a verdict that names nothing, and no words for an item no list knows", () => {
    expect(toEntryCheckDto(row({ answers: "1111111", verdict: "enter", missingItem: null })).missingItemLabel).toBeNull();
    expect(toEntryCheckDto(row({ missingItem: "gone" })).missingItemLabel).toBeNull();
  });
});
