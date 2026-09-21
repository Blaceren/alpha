import { describe, expect, it } from "vitest";
import type { ToolEntryCheck } from "@prisma/client";
import { ToolError } from "./errors";
import {
  CHECKLIST_ITEMS,
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
  it("is the presentation's nine items in three groups, four of them stop factors", () => {
    expect(CHECKLIST_ITEMS.map((item) => item.code)).toEqual([
      "no_news",
      "stable_connection",
      "payout_minimum",
      "market_state",
      "price_at_zone",
      "setup_conditions",
      "daily_limit",
      "no_revenge",
      "attention",
    ]);
    expect(CHECKLIST_ITEMS.filter((item) => item.stop).map((item) => item.code)).toEqual([
      "no_news",
      "stable_connection",
      "daily_limit",
      "no_revenge",
    ]);
    expect(checklistReference().groups.map((group) => group.label)).toEqual(["Среда", "Setup", "Моё состояние"]);
  });
});

describe("checklistVerdict", () => {
  it("allows the entry only when all nine are confirmed", () => {
    expect(checklistVerdict(ALL)).toEqual({ verdict: "enter", missingItem: null });
  });

  it("puts a stop factor before any other gap, whatever the order in the list", () => {
    expect(checklistVerdict(without("payout_minimum", "no_revenge"))).toEqual({
      verdict: "skip_stop",
      missingItem: "no_revenge",
    });
  });

  it("names the first unconfirmed condition when no stop factor is open", () => {
    expect(checklistVerdict(without("price_at_zone", "attention"))).toEqual({
      verdict: "skip_condition",
      missingItem: "price_at_zone",
    });
  });

  it("says not to enter when nothing is confirmed, naming the first stop factor", () => {
    const none = Object.fromEntries(CHECKLIST_ITEMS.map((item) => [item.code, false])) as unknown as ChecklistAnswers;
    expect(checklistVerdict(none)).toEqual({ verdict: "skip_stop", missingItem: "no_news" });
  });
});

describe("answers as nine characters", () => {
  it("round-trips in the list's order", () => {
    const answers = without("market_state");
    expect(encodeAnswers(answers)).toBe("111011111");
    expect(decodeAnswers("111011111")).toEqual(answers);
  });
});

describe("parseEntryCheck", () => {
  const body = { asset: "EURUSD_OTC", minPayoutPercent: 85, answers: ALL };

  it("accepts a check with and without a minimum payout", () => {
    expect(parseEntryCheck(body)).toEqual({ assetCode: "EURUSD_OTC", minPayoutPercent: 85, answers: ALL });
    expect(parseEntryCheck({ ...body, minPayoutPercent: null }).minPayoutPercent).toBeNull();
  });

  it("names the refused field, and refuses anything but the nine answers", () => {
    expect(refused({ ...body, asset: "DOGE" })).toBe("TOOL_VALIDATION:invalid_asset");
    expect(refused({ ...body, minPayoutPercent: 0 })).toBe("TOOL_VALIDATION:invalid_minPayoutPercent");
    expect(refused({ ...body, minPayoutPercent: 85.5 })).toBe("TOOL_VALIDATION:invalid_minPayoutPercent");
    expect(refused({ ...body, answers: { ...ALL, extra: true } })).toBe("TOOL_VALIDATION:invalid_answers");
    const missing: Record<string, boolean> = { ...ALL };
    delete missing.attention;
    expect(refused({ ...body, answers: missing })).toBe("TOOL_VALIDATION:invalid_answers");
    expect(refused({ ...body, answers: { ...ALL, attention: "yes" } })).toBe("TOOL_VALIDATION:invalid_answers");
    expect(refused({ ...body, verdict: "enter" })).toMatch(/^TOOL_VALIDATION:invalid_/);
    expect(refused(null)).toBe("TOOL_VALIDATION:invalid_check");
  });
});

describe("a kept check", () => {
  it("goes out with the asset's name, the answers by code, and the server's verdict", () => {
    const row: ToolEntryCheck = {
      id: "cmcheck0000000abcdefghij",
      userId: 7,
      assetCode: "EURUSD_OTC",
      minPayoutPercent: 85,
      listVersion: 1,
      answers: "110111111",
      verdict: "skip_condition",
      missingItem: "payout_minimum",
      createdAt: new Date("2026-09-21T12:30:00.000Z"),
    };
    const dto = toEntryCheckDto(row);
    expect(dto).toMatchObject({
      asset: { code: "EURUSD_OTC", label: "EUR/USD OTC" },
      minPayoutPercent: 85,
      verdict: "skip_condition",
      missingItem: "payout_minimum",
      createdAt: "2026-09-21T12:30:00.000Z",
    });
    expect(dto.answers.payout_minimum).toBe(false);
    expect(dto.answers.no_news).toBe(true);
    expect(dto).not.toHaveProperty("userId");
  });
});
