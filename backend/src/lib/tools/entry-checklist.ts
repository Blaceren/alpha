/**
 * TOOLS-V2 — Entry Checklist (L20): enter or skip, decided before the button
 * is pressed in Pocket.
 *
 * WHAT IT IS. Pocket never checks whether the conditions for an entry hold. The
 * checklist asks seven fixed questions (owner decision 2026-09-21: the list is
 * fixed, not written by the learner; the seven of 2026-10-07 replaced the nine)
 * in three groups — the environment, the chart, the trade — and gives a verdict:
 *
 *   any stop factor not confirmed   «Не входить: стоп-фактор» — this wins
 *   any other item not confirmed    «Не входить: условие не выполнено»
 *   all confirmed                   «Вход по плану допустим»
 *
 * The seven are all conditions (owner 2026-10-07: «все семь — условия»); the
 * stop factor stays in the rule for the kept checks of the first list, where
 * four items were ones. The verdict names the first unconfirmed item, in the
 * list's order. Declining a trade is a full decision (lesson L08), so a «не
 * входить» check is kept like any other.
 *
 * NOTHING IS AUTOMATIC. The learner confirms every item by hand; nothing is
 * read from Pocket, a news feed or another tool (owner decision: manual first).
 * The verdict is always the server's own, computed from the answers.
 *
 * A CHECK IS KEPT AS IT WAS. One row per check, never edited, never deleted —
 * and read with the list it was answered against (`listVersion`).
 */
import { z } from "zod";
import type { ToolEntryCheck } from "@prisma/client";
import { ToolError } from "./errors";
import { PAYOUT_PERCENT, tradingAssetByCode } from "./reference";

export const ENTRY_CHECKLIST_TOOL_CODE = "tool.entry_checklist" as const;

/** The version of the item list below; answers are stored against it. */
export const CHECKLIST_VERSION = 2;

export const CHECKLIST_GROUPS = [
  { code: "environment", label: "Среда" },
  { code: "chart", label: "График" },
  { code: "trade", label: "Сделка" },
] as const;
export type ChecklistGroup = (typeof CHECKLIST_GROUPS)[number]["code"];

/** The seven fixed items (owner 2026-10-07), in the order they are asked and answered. */
export const CHECKLIST_ITEMS = [
  { code: "asset_in_list", group: "environment", stop: false, label: "Актив из моего списка" },
  { code: "time_period", group: "environment", stop: false, label: "Время — подходящий период" },
  { code: "payout_checked", group: "environment", stop: false, label: "Payout посмотрел, планку посчитал" },
  { code: "market_state", group: "chart", stop: false, label: "Состояние определено: тренд, боковик или неясно" },
  { code: "area_named", group: "chart", stop: false, label: "Область названа" },
  { code: "size_by_plan", group: "trade", stop: false, label: "Размер по плану" },
  { code: "reason_in_words", group: "trade", stop: false, label: "Основание сформулировано словами" },
] as const satisfies readonly { code: string; group: ChecklistGroup; stop: boolean; label: string }[];

export type ChecklistItemCode = (typeof CHECKLIST_ITEMS)[number]["code"];

/**
 * The first list (2026-09-21 to 2026-10-07): nine items in three groups, four of
 * them stop factors. Kept so a check answered against it is still read as it
 * was — its answers decoded, the item its verdict names labelled.
 */
export const CHECKLIST_ITEMS_V1 = [
  { code: "no_news", group: "environment", stop: true, label: "Рядом нет важной новости (±15 мин)" },
  { code: "stable_connection", group: "environment", stop: true, label: "Связь стабильна" },
  { code: "payout_minimum", group: "environment", stop: false, label: "Payout не ниже моего минимума" },
  { code: "market_state", group: "setup", stop: false, label: "Состояние рынка определено: тренд или боковик" },
  { code: "price_at_zone", group: "setup", stop: false, label: "Цена у зоны, отмеченной до сессии" },
  { code: "setup_conditions", group: "setup", stop: false, label: "Все условия моего setup выполнены" },
  { code: "daily_limit", group: "state", stop: true, label: "Дневной лимит не достигнут" },
  { code: "no_revenge", group: "state", stop: true, label: "Нет желания отыграться" },
  { code: "attention", group: "state", stop: false, label: "Внимание на графике, не устал" },
] as const satisfies readonly { code: string; group: string; stop: boolean; label: string }[];

type ChecklistItemLike = { readonly code: string; readonly group: string; readonly stop: boolean; readonly label: string };

/** The list a kept check was answered against. An unknown version reads as the current one. */
export function checklistItemsOfVersion(version: number): readonly ChecklistItemLike[] {
  return version === 1 ? CHECKLIST_ITEMS_V1 : CHECKLIST_ITEMS;
}

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

/** The answers as one character per item, in the list's order. */
export function encodeAnswers(answers: ChecklistAnswers): string {
  return CHECKLIST_ITEMS.map((item) => (answers[item.code] ? "1" : "0")).join("");
}

/** The characters back into answers, by the list of the version they were written against. */
export function decodeAnswers(encoded: string, version: number = CHECKLIST_VERSION): Readonly<Record<string, boolean>> {
  return Object.fromEntries(checklistItemsOfVersion(version).map((item, index) => [item.code, encoded[index] === "1"]));
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
  /** The list the check was answered against; its answers and the named item are that list's. */
  readonly listVersion: number;
  readonly answers: Readonly<Record<string, boolean>>;
  readonly verdict: ChecklistVerdict;
  readonly missingItem: string | null;
  /** The named item as the learner read it when the check was made — the list may have changed since. */
  readonly missingItemLabel: string | null;
  readonly createdAt: string;
};

export function toEntryCheckDto(row: ToolEntryCheck): EntryCheckDto {
  const asset = tradingAssetByCode(row.assetCode);
  const items = checklistItemsOfVersion(row.listVersion);
  const missing = row.missingItem === null ? null : (items.find((item) => item.code === row.missingItem) ?? null);
  return {
    id: row.id,
    asset: { code: row.assetCode, label: asset?.label ?? row.assetCode },
    minPayoutPercent: row.minPayoutPercent,
    listVersion: row.listVersion,
    answers: decodeAnswers(row.answers, row.listVersion),
    verdict: row.verdict as ChecklistVerdict,
    missingItem: row.missingItem,
    missingItemLabel: missing?.label ?? null,
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
