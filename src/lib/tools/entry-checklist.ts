/**
 * TOOLS-V2 — Entry Checklist (L20): enter or skip, decided before the button
 * is pressed in Pocket.
 *
 * WHAT IT IS. Pocket never checks whether the conditions for an entry hold. The
 * checklist asks nine fixed questions (owner decision 2026-09-21: the list is
 * fixed, not written by the learner) in three groups — the environment, the
 * setup, the learner's own state — and gives a verdict:
 *
 *   any stop factor not confirmed   «Не входить: стоп-фактор» — this wins
 *   any other item not confirmed    «Не входить: условие не выполнено»
 *   all nine confirmed              «Вход по плану допустим»
 *
 * The verdict names the first unconfirmed item, in the list's order. Declining
 * a trade is a full decision (lesson L08), so a «не входить» check is kept like
 * any other.
 *
 * NOTHING IS AUTOMATIC. The learner confirms every item by hand; nothing is
 * read from Pocket, a news feed or another tool (owner decision: manual first).
 * The verdict is always the server's own, computed from the answers.
 *
 * A CHECK IS KEPT AS IT WAS. One row per check, never edited, never deleted.
 */
import { z } from "zod";
import type { ToolEntryCheck } from "@prisma/client";
import { ToolError } from "./errors";
import { PAYOUT_PERCENT, tradingAssetByCode } from "./reference";

export const ENTRY_CHECKLIST_TOOL_CODE = "tool.entry_checklist" as const;

/** The version of the item list below; answers are stored against it. */
export const CHECKLIST_VERSION = 1;

export const CHECKLIST_GROUPS = [
  { code: "environment", label: "Среда" },
  { code: "setup", label: "Setup" },
  { code: "state", label: "Моё состояние" },
] as const;
export type ChecklistGroup = (typeof CHECKLIST_GROUPS)[number]["code"];

/** The nine fixed items, in the order they are asked and answered. */
export const CHECKLIST_ITEMS = [
  { code: "no_news", group: "environment", stop: true, label: "Рядом нет важной новости (±15 мин)" },
  { code: "stable_connection", group: "environment", stop: true, label: "Связь стабильна" },
  { code: "payout_minimum", group: "environment", stop: false, label: "Payout не ниже моего минимума" },
  { code: "market_state", group: "setup", stop: false, label: "Состояние рынка определено: тренд или боковик" },
  { code: "price_at_zone", group: "setup", stop: false, label: "Цена у зоны, отмеченной до сессии" },
  { code: "setup_conditions", group: "setup", stop: false, label: "Все условия моего setup выполнены" },
  { code: "daily_limit", group: "state", stop: true, label: "Дневной лимит не достигнут" },
  { code: "no_revenge", group: "state", stop: true, label: "Нет желания отыграться" },
  { code: "attention", group: "state", stop: false, label: "Внимание на графике, не устал" },
] as const satisfies readonly { code: string; group: ChecklistGroup; stop: boolean; label: string }[];

export type ChecklistItemCode = (typeof CHECKLIST_ITEMS)[number]["code"];

export const CHECKLIST_VERDICTS = ["enter", "skip_stop", "skip_condition"] as const;
export type ChecklistVerdict = (typeof CHECKLIST_VERDICTS)[number];

export const CHECKLIST_LIMITS = {
  /** Checks shown under the checklist, newest first. */
  recentSize: 20,
} as const;

/* ------------------------------------------------------------- the verdict */

export type ChecklistAnswers = Readonly<Record<ChecklistItemCode, boolean>>;

/**
 * Stop factors first, then everything else, each in the list's order. The item
 * named is the first one the learner has not confirmed.
 */
export function checklistVerdict(answers: ChecklistAnswers): { verdict: ChecklistVerdict; missingItem: ChecklistItemCode | null } {
  const stop = CHECKLIST_ITEMS.find((item) => item.stop && !answers[item.code]);
  if (stop) return { verdict: "skip_stop", missingItem: stop.code };
  const condition = CHECKLIST_ITEMS.find((item) => !answers[item.code]);
  if (condition) return { verdict: "skip_condition", missingItem: condition.code };
  return { verdict: "enter", missingItem: null };
}

/** Nine answers as nine characters, in the list's order. */
export function encodeAnswers(answers: ChecklistAnswers): string {
  return CHECKLIST_ITEMS.map((item) => (answers[item.code] ? "1" : "0")).join("");
}

export function decodeAnswers(encoded: string): ChecklistAnswers {
  return Object.fromEntries(CHECKLIST_ITEMS.map((item, index) => [item.code, encoded[index] === "1"])) as Record<
    ChecklistItemCode,
    boolean
  >;
}

/* --------------------------------------------------------------- the check */

const answersShape = Object.fromEntries(CHECKLIST_ITEMS.map((item) => [item.code, z.boolean()])) as Record<
  ChecklistItemCode,
  z.ZodBoolean
>;

const checkSchema = z.strictObject({
  asset: z.string().max(40),
  minPayoutPercent: z.number().int().min(PAYOUT_PERCENT.min).max(PAYOUT_PERCENT.max).nullable(),
  answers: z.strictObject(answersShape),
});

export type EntryCheckInput = {
  readonly assetCode: string;
  readonly minPayoutPercent: number | null;
  readonly answers: ChecklistAnswers;
};

/** Validate a check body. Every refusal is a `TOOL_VALIDATION` naming the field. */
export function parseEntryCheck(input: unknown): EntryCheckInput {
  const parsed = checkSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    throw new ToolError("TOOL_VALIDATION", typeof field === "string" ? `invalid_${field}` : "invalid_check");
  }
  const check = parsed.data;
  if (!tradingAssetByCode(check.asset)) throw new ToolError("TOOL_VALIDATION", "invalid_asset");
  return { assetCode: check.asset, minPayoutPercent: check.minPayoutPercent, answers: check.answers };
}

/* ---------------------------------------------------------------- output */

export type EntryCheckDto = {
  readonly id: string;
  readonly asset: { readonly code: string; readonly label: string };
  readonly minPayoutPercent: number | null;
  readonly answers: ChecklistAnswers;
  readonly verdict: ChecklistVerdict;
  readonly missingItem: ChecklistItemCode | null;
  readonly createdAt: string;
};

export function toEntryCheckDto(row: ToolEntryCheck): EntryCheckDto {
  const asset = tradingAssetByCode(row.assetCode);
  return {
    id: row.id,
    asset: { code: row.assetCode, label: asset?.label ?? row.assetCode },
    minPayoutPercent: row.minPayoutPercent,
    answers: decodeAnswers(row.answers),
    verdict: row.verdict as ChecklistVerdict,
    missingItem: row.missingItem as ChecklistItemCode | null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The list the form asks, grouped, with the stop factors marked. */
export function checklistReference() {
  return {
    groups: CHECKLIST_GROUPS.map((group) => ({ ...group })),
    items: CHECKLIST_ITEMS.map((item) => ({ ...item })),
  };
}
