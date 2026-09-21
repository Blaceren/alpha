/**
 * TOOLS-V2 — Trade Card (L5): the plan of ONE binary-options trade, written
 * before the learner opens it in Pocket, and its outcome after expiry.
 *
 * WHAT IT IS. Pocket never asks why a trade is opened. The card makes the
 * learner write the asset, direction, amount, payout, expiry and the REASON,
 * see both possible outcomes, and fix that plan before pressing the button in
 * Pocket. ATA opens nothing: the trade itself is always made by hand in Pocket.
 *
 * LIFECYCLE — three states, one open card per learner:
 *
 *   fixed      the plan is fixed ("Зафиксировать план"); the learner opens the
 *              trade in Pocket and waits for expiry. The plan may be re-fixed
 *              ("Изменить план"), and every re-fix is counted.
 *   saved      terminal: the result (profit or loss) and an optional
 *              observation are recorded.
 *   cancelled  terminal: the learner did not open the trade after all. The
 *              card is kept, never deleted, and never counts as a trade.
 *
 * MONEY. The amount is the stake of this one trade, typed by the learner, in
 * integer minor units (cents). The two outcomes are a projection of this one
 * trade — never an aggregate, never a balance (DD-303/DD-304 still hold for
 * this tool).
 */
import { z } from "zod";
import type { ToolTradeCard } from "@prisma/client";
import { ToolError } from "./errors";
import { isAcceptableTradeDate } from "./dates";
import { expiryByCode, tradingAssetByCode } from "./reference";

export const TRADE_CARD_TOOL_CODE = "tool.trade_card" as const;

export const TRADE_CARD_STATUSES = ["fixed", "saved", "cancelled"] as const;
export type TradeCardStatus = (typeof TRADE_CARD_STATUSES)[number];

export const TRADE_CARD_DIRECTIONS = ["up", "down"] as const;
export type TradeCardDirection = (typeof TRADE_CARD_DIRECTIONS)[number];

export const TRADE_CARD_RESULTS = ["profit", "loss"] as const;
export type TradeCardResult = (typeof TRADE_CARD_RESULTS)[number];

export const TRADE_CARD_LIMITS = {
  /** 0.01 … 1 000 000.00 in the account currency. */
  maxAmountMinor: 100_000_000,
  minReasonLength: 3,
  maxReasonLength: 1000,
  maxObservationLength: 2000,
} as const;

/* ------------------------------------------------------------------ money */

/** "8", "8.5" or "8.50" — up to 7 whole digits and 2 decimals, no sign. */
const AMOUNT_RE = /^(\d{1,7})(?:\.(\d{1,2}))?$/;

/** Parse a learner-typed amount into minor units, or null when it is not one. */
export function parseAmountToMinor(raw: string): number | null {
  const match = AMOUNT_RE.exec(raw.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const minor = whole * 100 + fraction;
  if (!Number.isSafeInteger(minor) || minor < 1 || minor > TRADE_CARD_LIMITS.maxAmountMinor) return null;
  return minor;
}

/** Minor units as a fixed two-decimal string: 720 → "7.20". */
export function formatMinor(minor: number): string {
  const whole = Math.floor(minor / 100);
  const fraction = String(minor % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

/**
 * The two outcomes of one binary-options trade.
 *
 * Prognosis right: the stake times the payout, rounded half-up to a cent
 * ($8 at 90% → $7.20). Prognosis wrong: the whole stake is lost. There is no
 * third outcome in the card: no early close exists.
 */
export function tradeCardOutcomes(amountMinor: number, payoutPercent: number) {
  return {
    ifRightMinor: Math.round((amountMinor * payoutPercent) / 100),
    ifWrongMinor: amountMinor,
  };
}

/* ------------------------------------------------------------- the plan */

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const planSchema = z.strictObject({
  asset: z.string().max(40),
  direction: z.enum(TRADE_CARD_DIRECTIONS),
  amount: z.string().max(20),
  payoutPercent: z.number().int().min(1).max(100),
  expiry: z.string().max(10),
  entryTime: z.string().regex(HHMM_RE),
  reason: z.string().max(TRADE_CARD_LIMITS.maxReasonLength * 2),
});

export type TradeCardPlan = {
  readonly assetCode: string;
  readonly direction: TradeCardDirection;
  readonly amountMinor: number;
  readonly payoutPercent: number;
  readonly expiryCode: string;
  readonly entryTime: string;
  readonly reason: string;
};

/** Validate a plan body. Every refusal is a `TOOL_VALIDATION` with a named field. */
export function parseTradeCardPlan(input: unknown): TradeCardPlan {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    throw new ToolError("TOOL_VALIDATION", typeof field === "string" ? `invalid_${field}` : "invalid_plan");
  }
  const plan = parsed.data;
  if (!tradingAssetByCode(plan.asset)) throw new ToolError("TOOL_VALIDATION", "invalid_asset");
  if (!expiryByCode(plan.expiry)) throw new ToolError("TOOL_VALIDATION", "invalid_expiry");
  const amountMinor = parseAmountToMinor(plan.amount);
  if (amountMinor === null) throw new ToolError("TOOL_VALIDATION", "invalid_amount");
  const reason = plan.reason.trim();
  if (reason.length < TRADE_CARD_LIMITS.minReasonLength || reason.length > TRADE_CARD_LIMITS.maxReasonLength) {
    throw new ToolError("TOOL_VALIDATION", "invalid_reason");
  }
  return {
    assetCode: plan.asset,
    direction: plan.direction,
    amountMinor,
    payoutPercent: plan.payoutPercent,
    expiryCode: plan.expiry,
    entryTime: plan.entryTime,
    reason,
  };
}

/* ------------------------------------------------------------ the change */

const changeSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("refix"), plan: z.unknown() }),
  z.strictObject({
    action: z.literal("save"),
    result: z.enum(TRADE_CARD_RESULTS),
    observation: z.string().max(TRADE_CARD_LIMITS.maxObservationLength * 2).nullable().optional(),
    /** The learner's own calendar date, for the Trading Journal entry. Optional. */
    tradeDate: z.string().max(10).nullable().optional(),
  }),
  z.strictObject({ action: z.literal("cancel") }),
]);

export type TradeCardChange =
  | { readonly action: "refix"; readonly plan: TradeCardPlan }
  | {
      readonly action: "save";
      readonly result: TradeCardResult;
      readonly observation: string | null;
      readonly tradeDate: string | null;
    }
  | { readonly action: "cancel" };

export function parseTradeCardChange(input: unknown, now: Date = new Date()): TradeCardChange {
  const parsed = changeSchema.safeParse(input);
  if (!parsed.success) throw new ToolError("TOOL_VALIDATION", "invalid_change");
  const change = parsed.data;
  if (change.action === "refix") return { action: "refix", plan: parseTradeCardPlan(change.plan) };
  if (change.action === "save") {
    const observation = (change.observation ?? "").trim();
    if (observation.length > TRADE_CARD_LIMITS.maxObservationLength) {
      throw new ToolError("TOOL_VALIDATION", "invalid_observation");
    }
    const tradeDate = change.tradeDate ?? null;
    if (tradeDate !== null && !isAcceptableTradeDate(tradeDate, now)) {
      throw new ToolError("TOOL_VALIDATION", "invalid_tradeDate");
    }
    return {
      action: "save",
      result: change.result,
      observation: observation.length > 0 ? observation : null,
      tradeDate,
    };
  }
  return { action: "cancel" };
}

/* --------------------------------------------------------------- output */

export type TradeCardDto = {
  readonly id: string;
  readonly status: TradeCardStatus;
  readonly plan: {
    readonly asset: { readonly code: string; readonly label: string };
    readonly direction: TradeCardDirection;
    readonly amount: string;
    readonly payoutPercent: number;
    readonly expiry: { readonly code: string; readonly label: string; readonly seconds: number };
    readonly entryTime: string;
    readonly reason: string;
  };
  readonly outcomes: { readonly ifRight: string; readonly ifWrong: string };
  readonly fixedAt: string;
  readonly planRevisionCount: number;
  readonly result: TradeCardResult | null;
  readonly observation: string | null;
  readonly savedAt: string | null;
  readonly cancelledAt: string | null;
  readonly createdAt: string;
};

export function toTradeCardDto(row: ToolTradeCard): TradeCardDto {
  const asset = tradingAssetByCode(row.assetCode);
  const expiry = expiryByCode(row.expiryCode);
  const outcomes = tradeCardOutcomes(row.amountMinor, row.payoutPercent);
  return {
    id: row.id,
    status: row.status as TradeCardStatus,
    plan: {
      // A code later withdrawn from the list still renders, under its code.
      asset: { code: row.assetCode, label: asset?.label ?? row.assetCode },
      direction: row.direction as TradeCardDirection,
      amount: formatMinor(row.amountMinor),
      payoutPercent: row.payoutPercent,
      expiry: { code: row.expiryCode, label: expiry?.label ?? row.expiryCode, seconds: expiry?.seconds ?? 0 },
      entryTime: row.entryTime,
      reason: row.reason,
    },
    outcomes: { ifRight: formatMinor(outcomes.ifRightMinor), ifWrong: formatMinor(outcomes.ifWrongMinor) },
    fixedAt: row.fixedAt.toISOString(),
    planRevisionCount: row.planRevisionCount,
    result: (row.result as TradeCardResult | null) ?? null,
    observation: row.observation,
    savedAt: row.savedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
