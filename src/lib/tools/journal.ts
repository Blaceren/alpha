/**
 * TOOLS-V2 — Trading Journal (L10): finished trades, as the learner reviews them.
 *
 * WHAT POCKET DOES NOT KEEP. Pocket keeps the trade history, but not why a trade
 * was opened, whether the plan was followed, or what to take from it. The
 * journal keeps exactly that, per trade, in the learner's own words.
 *
 * TWO SOURCES (owner decisions 2026-09-21):
 *   trade_card  a Trade Card SAVED AFTER THE JOURNAL OPENED becomes an entry at
 *               the moment it is saved — «только новые»: cards from L5–L9 never
 *               arrive. The entry starts as the card's trade (asset, direction,
 *               stake, payout, expiry, time, the reason as the plan, the result);
 *               the card's observation becomes the entry's conclusion.
 *   manual      a trade recorded by hand, every field the learner's.
 *
 * THE ENTRY IS THE LEARNER'S RECORD — ALL OF IT (owner, 2026-10-01: «функционал
 * изменения записи полноценный», «кнопка и функционал удаления записи»). Until
 * then an entry made from a card could have only its review edited and nothing
 * could be deleted, so a result marked wrongly on the card — a mis-click after
 * expiry — stayed wrong in the journal and in Personal Stats for ever. Now any
 * entry can be replaced whole and any entry can be deleted. What does NOT
 * change is the Trade Card: the plan fixed before the trade stays in the card
 * exactly as it was fixed, and an entry that no longer says what its card says
 * is told apart (`editedAfterCard`), so the journal never passes a corrected
 * record off as the card's.
 *
 * THE REVIEW IS THE LEARNER'S. «По плану / нарушен» and which rules were broken
 * are marked by the learner themselves (owner decision: «ученик сам для
 * начала»). The rules come from one fixed list, so Personal Stats (L25) can count
 * them later without guessing at free text.
 *
 * THE FIELDS, and why these. The successful trading journals converge on the
 * same core: the trade itself, the thesis written BEFORE it, how the execution
 * actually went, whether the trader's own rules held (and which broke), and the
 * lesson for next time. Screenshots, emotions scales and setup tags are left
 * out of this first version: the rule list already carries the behavioural
 * breaks that matter at L10 (revenge trading, trading tired, over-sizing).
 *
 * MONEY IS ONE STAKE PER TRADE, never a balance or a running total (DD-303/304).
 * The summary counts entries; it never sums money.
 */
import { z } from "zod";
import type { ToolJournalEntry, ToolJournalViolation, ToolTradeCard } from "@prisma/client";
import { ToolError } from "./errors";
import { isAcceptableTradeDate } from "./dates";
import { expiryByCode, tradingAssetByCode } from "./reference";
import {
  TRADE_CARD_DIRECTIONS,
  TRADE_CARD_LIMITS,
  TRADE_CARD_RESULTS,
  formatMinor,
  parseAmountToMinor,
  tradeCardOutcomes,
  type TradeCardDirection,
  type TradeCardResult,
} from "./trade-card";

export const TRADING_JOURNAL_TOOL_CODE = "tool.trading_journal" as const;

export const JOURNAL_SOURCES = ["trade_card", "manual"] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

/**
 * The rules a learner can say they broke. ONE FIXED LIST, OURS. Codes are stored,
 * labels are not, so a label can be corrected without rewriting a row; a code,
 * once shipped, is never reused for a different rule.
 */
export const JOURNAL_VIOLATIONS = [
  { code: "no_reason", label: "Вход без записанной причины" },
  { code: "news_nearby", label: "Рядом важная новость" },
  { code: "after_daily_limit", label: "Сделка после дневного лимита" },
  { code: "amount_above_plan", label: "Сумма больше плана" },
  { code: "revenge", label: "Хотел отыграться после убытка" },
  { code: "not_my_setup", label: "Вход не по своему setup" },
  { code: "tired", label: "Усталость или невнимательность" },
  { code: "other", label: "Другое" },
] as const satisfies ReadonlyArray<{ code: string; label: string }>;

const VIOLATION_CODES: ReadonlySet<string> = new Set(JOURNAL_VIOLATIONS.map((violation) => violation.code));
const VIOLATION_ORDER = new Map<string, number>(JOURNAL_VIOLATIONS.map((violation, index) => [violation.code, index]));

export const JOURNAL_FILTERS = ["all", "violated", "no_conclusion"] as const;
export type JournalFilter = (typeof JOURNAL_FILTERS)[number];

export const JOURNAL_LIMITS = {
  maxPlanLength: TRADE_CARD_LIMITS.maxReasonLength,
  maxExecutionLength: 2000,
  /** As long as a card's observation, which becomes the conclusion. */
  maxConclusionLength: TRADE_CARD_LIMITS.maxObservationLength,
  pageSize: 20,
} as const;

/* ------------------------------------------------------------------- dates */

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ------------------------------------------------------------ the review */

export type JournalReview = {
  readonly planFollowed: boolean | null;
  readonly violations: readonly string[];
  readonly execution: string | null;
  readonly conclusion: string | null;
};

const optionalText = (max: number) => z.string().max(max * 2).nullable().optional();

const reviewShape = {
  planFollowed: z.boolean().nullable().optional(),
  violations: z.array(z.string().max(40)).max(JOURNAL_VIOLATIONS.length).optional(),
  execution: optionalText(JOURNAL_LIMITS.maxExecutionLength),
  conclusion: optionalText(JOURNAL_LIMITS.maxConclusionLength),
};

function cleanText(raw: string | null | undefined, max: number, field: string): string | null {
  const text = (raw ?? "").trim();
  if (text.length > max) throw new ToolError("TOOL_VALIDATION", `invalid_${field}`);
  return text.length > 0 ? text : null;
}

function cleanReview(raw: {
  planFollowed?: boolean | null;
  violations?: string[];
  execution?: string | null;
  conclusion?: string | null;
}): JournalReview {
  const planFollowed = raw.planFollowed ?? null;
  const violations = [...new Set(raw.violations ?? [])];
  for (const code of violations) {
    if (!VIOLATION_CODES.has(code)) throw new ToolError("TOOL_VALIDATION", "invalid_violations");
  }
  // A broken rule is only ever recorded against a broken plan.
  if (violations.length > 0 && planFollowed !== false) throw new ToolError("TOOL_VALIDATION", "invalid_violations");
  violations.sort((left, right) => (VIOLATION_ORDER.get(left) ?? 0) - (VIOLATION_ORDER.get(right) ?? 0));
  return {
    planFollowed,
    violations,
    execution: cleanText(raw.execution, JOURNAL_LIMITS.maxExecutionLength, "execution"),
    conclusion: cleanText(raw.conclusion, JOURNAL_LIMITS.maxConclusionLength, "conclusion"),
  };
}

/* --------------------------------------------------------- a manual trade */

export type JournalTrade = {
  readonly tradeDate: string;
  readonly entryTime: string;
  readonly assetCode: string;
  readonly direction: TradeCardDirection;
  readonly amountMinor: number;
  readonly payoutPercent: number;
  readonly expiryCode: string;
  readonly result: TradeCardResult;
  readonly plan: string | null;
};

export type JournalManualEntry = JournalTrade & JournalReview;

const manualSchema = z.strictObject({
  tradeDate: z.string().max(10),
  entryTime: z.string().regex(HHMM_RE),
  asset: z.string().max(40),
  direction: z.enum(TRADE_CARD_DIRECTIONS),
  amount: z.string().max(20),
  payoutPercent: z.number().int().min(1).max(100),
  expiry: z.string().max(10),
  result: z.enum(TRADE_CARD_RESULTS),
  plan: optionalText(JOURNAL_LIMITS.maxPlanLength),
  ...reviewShape,
});

/** Validate a hand-recorded trade and its review. Refusals name the field. */
export function parseJournalManualEntry(input: unknown, now: Date = new Date()): JournalManualEntry {
  const parsed = manualSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    throw new ToolError("TOOL_VALIDATION", typeof field === "string" ? `invalid_${field}` : "invalid_entry");
  }
  const entry = parsed.data;
  if (!isAcceptableTradeDate(entry.tradeDate, now)) throw new ToolError("TOOL_VALIDATION", "invalid_tradeDate");
  if (!tradingAssetByCode(entry.asset)) throw new ToolError("TOOL_VALIDATION", "invalid_asset");
  if (!expiryByCode(entry.expiry)) throw new ToolError("TOOL_VALIDATION", "invalid_expiry");
  const amountMinor = parseAmountToMinor(entry.amount);
  if (amountMinor === null) throw new ToolError("TOOL_VALIDATION", "invalid_amount");
  return {
    tradeDate: entry.tradeDate,
    entryTime: entry.entryTime,
    assetCode: entry.asset,
    direction: entry.direction,
    amountMinor,
    payoutPercent: entry.payoutPercent,
    expiryCode: entry.expiry,
    result: entry.result,
    plan: cleanText(entry.plan, JOURNAL_LIMITS.maxPlanLength, "plan"),
    ...cleanReview(entry),
  };
}

/* -------------------------------------------------------------- a change */

export type JournalChange =
  | { readonly kind: "review"; readonly review: JournalReview }
  | { readonly kind: "entry"; readonly entry: JournalManualEntry };

/**
 * PATCH body. `review` changes only the learner's review; `entry` replaces the
 * entry whole — the trade, the plan and the review — whichever source it came
 * from. `manual` is the name `entry` had while only a hand-recorded entry could
 * be replaced; it is still read, so an Academy build from before 2026-10-01
 * keeps working against this Backend.
 */
export function parseJournalChange(input: unknown, now: Date = new Date()): JournalChange {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ToolError("TOOL_VALIDATION", "invalid_change");
  }
  const { kind, ...rest } = input as Record<string, unknown>;
  if (kind === "review") {
    const parsed = z.strictObject(reviewShape).safeParse(rest);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      throw new ToolError("TOOL_VALIDATION", typeof field === "string" ? `invalid_${field}` : "invalid_change");
    }
    return { kind: "review", review: cleanReview(parsed.data) };
  }
  if (kind === "entry" || kind === "manual") return { kind: "entry", entry: parseJournalManualEntry(rest, now) };
  throw new ToolError("TOOL_VALIDATION", "invalid_change");
}

/* ------------------------------------------------------------ the list query */

export type JournalQuery = { readonly filter: JournalFilter; readonly before: string | null };

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

/** `?filter=all|violated|no_conclusion&before=<entryId>`, and nothing else. */
export function parseJournalQuery(params: URLSearchParams): JournalQuery {
  for (const key of params.keys()) {
    if (key !== "filter" && key !== "before") throw new ToolError("TOOL_VALIDATION", "unexpected_query_parameter");
  }
  const filterRaw = params.get("filter") ?? "all";
  if (!(JOURNAL_FILTERS as readonly string[]).includes(filterRaw)) {
    throw new ToolError("TOOL_VALIDATION", "invalid_filter");
  }
  const before = params.get("before");
  if (before !== null && !ID_RE.test(before)) throw new ToolError("TOOL_VALIDATION", "invalid_before");
  return { filter: filterRaw as JournalFilter, before };
}

/* ------------------------------------------------------------------ output */

export type JournalEntryDto = {
  readonly id: string;
  readonly source: JournalSource;
  readonly tradeCardId: string | null;
  readonly tradeDate: string;
  readonly entryTime: string;
  readonly asset: { readonly code: string; readonly label: string };
  readonly direction: TradeCardDirection;
  readonly amount: string;
  readonly payoutPercent: number;
  readonly expiry: { readonly code: string; readonly label: string; readonly seconds: number };
  readonly result: TradeCardResult;
  /** The money of THIS trade: stake × payout on profit, the stake on loss. */
  readonly resultAmount: string;
  readonly plan: string | null;
  readonly execution: string | null;
  readonly conclusion: string | null;
  readonly planFollowed: boolean | null;
  readonly violations: readonly string[];
  /**
   * True for an entry made from a Trade Card whose trade no longer says what
   * the card says — the learner corrected it here. Always false for a
   * hand-recorded entry. Computed against the card on every read, never stored:
   * correcting the entry back makes it false again.
   */
  readonly editedAfterCard: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** What of a card an entry is compared with: the trade the card fixed and its result. */
export type JournalCardTrade = Pick<
  ToolTradeCard,
  "entryTime" | "assetCode" | "direction" | "amountMinor" | "payoutPercent" | "expiryCode" | "result" | "reason"
>;

export type JournalRow = ToolJournalEntry & {
  violations: Pick<ToolJournalViolation, "code">[];
  tradeCard: JournalCardTrade | null;
};

/**
 * Whether an entry made from a card still says what the card says. The date is
 * not compared — a card has none, the entry was dated by the learner's calendar
 * when the card was saved — and neither is the review, which was always the
 * learner's to write.
 */
export function entryDiffersFromCard(row: JournalRow): boolean {
  const card = row.tradeCard;
  if (row.source !== "trade_card" || !card) return false;
  return (
    row.entryTime !== card.entryTime ||
    row.assetCode !== card.assetCode ||
    row.direction !== card.direction ||
    row.amountMinor !== card.amountMinor ||
    row.payoutPercent !== card.payoutPercent ||
    row.expiryCode !== card.expiryCode ||
    row.result !== card.result ||
    (row.plan ?? "") !== card.reason
  );
}

export function toJournalEntryDto(row: JournalRow): JournalEntryDto {
  const asset = tradingAssetByCode(row.assetCode);
  const expiry = expiryByCode(row.expiryCode);
  const outcomes = tradeCardOutcomes(row.amountMinor, row.payoutPercent);
  const result = row.result as TradeCardResult;
  const violations = row.violations.map((violation) => violation.code);
  violations.sort((left, right) => (VIOLATION_ORDER.get(left) ?? 99) - (VIOLATION_ORDER.get(right) ?? 99));
  return {
    id: row.id,
    source: row.source as JournalSource,
    tradeCardId: row.tradeCardId,
    tradeDate: row.tradeDate,
    entryTime: row.entryTime,
    asset: { code: row.assetCode, label: asset?.label ?? row.assetCode },
    direction: row.direction as TradeCardDirection,
    amount: formatMinor(row.amountMinor),
    payoutPercent: row.payoutPercent,
    expiry: { code: row.expiryCode, label: expiry?.label ?? row.expiryCode, seconds: expiry?.seconds ?? 0 },
    result,
    resultAmount: formatMinor(result === "profit" ? outcomes.ifRightMinor : outcomes.ifWrongMinor),
    plan: row.plan,
    execution: row.execution,
    conclusion: row.conclusion,
    planFollowed: row.planFollowed,
    violations,
    editedAfterCard: entryDiffersFromCard(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The journal fields a saved Trade Card carries into its entry. */
export function tradeFromCard(card: ToolTradeCard, tradeDate: string): JournalTrade & { conclusion: string | null } {
  return {
    tradeDate,
    entryTime: card.entryTime,
    assetCode: card.assetCode,
    direction: card.direction as TradeCardDirection,
    amountMinor: card.amountMinor,
    payoutPercent: card.payoutPercent,
    expiryCode: card.expiryCode,
    result: card.result as TradeCardResult,
    plan: card.reason,
    conclusion: card.observation,
  };
}

export function journalReference() {
  return { violations: JOURNAL_VIOLATIONS.map(({ code, label }) => ({ code, label })) };
}
