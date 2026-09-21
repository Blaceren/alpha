/**
 * Trade Card (L5) — the plan of ONE binary-option trade, written before the
 * button is pressed in Pocket.
 *
 * THE BACKEND IS THE AUTHORITY. Every rule below is a copy of the Backend's
 * (`backend/src/lib/tools/trade-card.ts`), kept here so the learner hears about
 * a mistake while typing instead of after a round trip. The Backend re-checks
 * all of it and its answer wins: a value this file lets through and the Backend
 * refuses comes back as a field error, never as a silent loss.
 *
 * MONEY IS ONE STAKE, NEVER A BALANCE. The card shows the two outcomes of this
 * trade and nothing else — no total, no P/L, no win rate (DD-303/DD-304). Amounts
 * travel as decimal strings ("8.00") and are computed in integer cents.
 */

/* ------------------------------------------------------------------ types */

export type TradeDirection = "up" | "down";
export type TradeResult = "profit" | "loss";
export type TradeCardStatus = "fixed" | "saved" | "cancelled";

export type TradeCardReference = {
  readonly assets: ReadonlyArray<{ readonly code: string; readonly label: string; readonly group: string }>;
  readonly expiries: ReadonlyArray<{ readonly code: string; readonly label: string; readonly seconds: number }>;
};

/** The card exactly as the Backend sends it. */
export type TradeCard = {
  readonly id: string;
  readonly status: TradeCardStatus;
  readonly plan: {
    readonly asset: { readonly code: string; readonly label: string };
    readonly direction: TradeDirection;
    readonly amount: string;
    readonly payoutPercent: number;
    readonly expiry: { readonly code: string; readonly label: string; readonly seconds: number };
    readonly entryTime: string;
    readonly reason: string;
  };
  readonly outcomes: { readonly ifRight: string; readonly ifWrong: string };
  readonly fixedAt: string;
  readonly planRevisionCount: number;
  readonly result: TradeResult | null;
  readonly observation: string | null;
  readonly savedAt: string | null;
  readonly cancelledAt: string | null;
  readonly createdAt: string;
};

/** What the form holds while the learner types: strings, as typed. */
export type TradeCardDraft = {
  asset: string;
  direction: TradeDirection | "";
  amount: string;
  payoutPercent: string;
  expiry: string;
  entryTime: string;
  reason: string;
};

/** What the Backend accepts as a plan. */
export type TradeCardPlanInput = {
  asset: string;
  direction: TradeDirection;
  amount: string;
  payoutPercent: number;
  expiry: string;
  entryTime: string;
  reason: string;
};

export type DraftField = keyof TradeCardDraft;
export type DraftErrors = Partial<Record<DraftField, string>>;

/* ----------------------------------------------------------------- limits */

/** Mirrors the Backend limits. $1 000 000.00 is a typo guard, not a suggestion. */
export const TRADE_CARD_LIMITS = {
  maxAmountMinor: 100_000_000,
  reasonMin: 3,
  reasonMax: 1000,
  observationMax: 2000,
} as const;

const AMOUNT_RE = /^(\d{1,7})(?:\.(\d{1,2}))?$/;
const ENTRY_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ------------------------------------------------------------------ money */

/**
 * The stake in cents, or null. A comma is accepted as the decimal mark because
 * that is how most of our learners type it; the Backend receives a dot.
 */
export function parseAmountToMinor(raw: string): number | null {
  const match = AMOUNT_RE.exec(raw.trim().replace(",", "."));
  if (!match) return null;
  const whole = Number(match[1]);
  const cents = match[2] ? Number(match[2].padEnd(2, "0")) : 0;
  const minor = whole * 100 + cents;
  if (minor < 1 || minor > TRADE_CARD_LIMITS.maxAmountMinor) return null;
  return minor;
}

export function formatMinor(minor: number): string {
  const whole = Math.floor(minor / 100);
  const cents = minor % 100;
  return `${whole}.${String(cents).padStart(2, "0")}`;
}

/** Same arithmetic as the Backend: right = stake × payout, rounded to a cent; wrong = the stake. */
export function outcomesFor(amountMinor: number, payoutPercent: number): { ifRightMinor: number; ifWrongMinor: number } {
  return { ifRightMinor: Math.round((amountMinor * payoutPercent) / 100), ifWrongMinor: amountMinor };
}

const MINUS = "−";

export function gainLabel(amount: string): string {
  return `+$${amount}`;
}

export function lossLabel(amount: string): string {
  return `${MINUS}$${amount}`;
}

/** The live outcomes under the form, or null while the stake or payout is not valid yet. */
export function draftOutcomes(draft: Pick<TradeCardDraft, "amount" | "payoutPercent">): { ifRight: string; ifWrong: string } | null {
  const amountMinor = parseAmountToMinor(draft.amount);
  const payout = parsePayout(draft.payoutPercent);
  if (amountMinor === null || payout === null) return null;
  const { ifRightMinor, ifWrongMinor } = outcomesFor(amountMinor, payout);
  return { ifRight: formatMinor(ifRightMinor), ifWrong: formatMinor(ifWrongMinor) };
}

function parsePayout(raw: string): number | null {
  const trimmed = raw.trim().replace("%", "").trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= 100 ? value : null;
}

/* ------------------------------------------------------------- the draft */

export function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** A blank card. The entry time starts at "now", which is when most plans are written. */
export function emptyDraft(now: Date): TradeCardDraft {
  return { asset: "", direction: "", amount: "", payoutPercent: "", expiry: "", entryTime: hhmm(now), reason: "" };
}

/** «Изменить план»: the form again, holding the fixed plan. */
export function draftFromCard(card: TradeCard): TradeCardDraft {
  return {
    asset: card.plan.asset.code,
    direction: card.plan.direction,
    amount: card.plan.amount,
    payoutPercent: String(card.plan.payoutPercent),
    expiry: card.plan.expiry.code,
    entryTime: card.plan.entryTime,
    reason: card.plan.reason,
  };
}

const MESSAGES: Record<DraftField, string> = {
  asset: "Выберите актив из списка.",
  direction: "Выберите направление: выше или ниже.",
  amount: "Сумма — число больше нуля, до двух знаков после точки.",
  payoutPercent: "Payout — целое число от 1 до 100.",
  expiry: "Выберите экспирацию.",
  entryTime: "Время входа в формате ЧЧ:ММ.",
  reason: `Запишите причину входа — от ${TRADE_CARD_LIMITS.reasonMin} символов.`,
};

export function fieldMessage(field: DraftField): string {
  return MESSAGES[field];
}

/**
 * Check the draft the way the Backend will. Every field is checked, so the
 * learner sees all of what is missing at once rather than one field per try.
 */
export function validateDraft(
  draft: TradeCardDraft,
  reference: TradeCardReference,
): { ok: true; plan: TradeCardPlanInput } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {};
  if (!reference.assets.some((asset) => asset.code === draft.asset)) errors.asset = MESSAGES.asset;
  if (draft.direction !== "up" && draft.direction !== "down") errors.direction = MESSAGES.direction;
  const amountMinor = parseAmountToMinor(draft.amount);
  if (amountMinor === null) errors.amount = MESSAGES.amount;
  const payout = parsePayout(draft.payoutPercent);
  if (payout === null) errors.payoutPercent = MESSAGES.payoutPercent;
  if (!reference.expiries.some((expiry) => expiry.code === draft.expiry)) errors.expiry = MESSAGES.expiry;
  if (!ENTRY_TIME_RE.test(draft.entryTime.trim())) errors.entryTime = MESSAGES.entryTime;
  const reason = draft.reason.trim();
  if (reason.length < TRADE_CARD_LIMITS.reasonMin) errors.reason = MESSAGES.reason;
  else if (reason.length > TRADE_CARD_LIMITS.reasonMax) {
    errors.reason = `Причина — не длиннее ${TRADE_CARD_LIMITS.reasonMax} символов.`;
  }

  if (Object.keys(errors).length > 0 || amountMinor === null || payout === null) return { ok: false, errors };
  return {
    ok: true,
    plan: {
      asset: draft.asset,
      direction: draft.direction as TradeDirection,
      amount: formatMinor(amountMinor),
      payoutPercent: payout,
      expiry: draft.expiry,
      entryTime: draft.entryTime.trim(),
      reason,
    },
  };
}

/** The Backend names a refused field as `invalid_<field>`; map it back onto the form. */
export function fieldOfServerDetail(detail: string | null): DraftField | null {
  switch (detail) {
    case "invalid_asset":
      return "asset";
    case "invalid_direction":
      return "direction";
    case "invalid_amount":
      return "amount";
    case "invalid_payoutPercent":
      return "payoutPercent";
    case "invalid_expiry":
      return "expiry";
    case "invalid_entryTime":
      return "entryTime";
    case "invalid_reason":
      return "reason";
    default:
      return null;
  }
}

/* ------------------------------------------------------------- the steps */

export const TRADE_CARD_STEPS = ["Подготовка", "Открытие", "Экспирация", "Результат", "Разбор"] as const;

/**
 * Where the learner is, as an index into `TRADE_CARD_STEPS`.
 *
 * Nothing here is a gate. The steps only describe the trade: before the plan is
 * fixed it is preparation; after it, the learner's own entry time and expiry
 * say whether the trade is about to open, running, or over. The entry time is
 * the learner's local clock time, so "now" is too. A time more than twelve hours
 * ahead is read as yesterday's, which is what a plan written just after midnight
 * for a trade just before it means.
 */
export function tradeCardStep(
  card: Pick<TradeCard, "status" | "plan"> | null,
  now: Date,
  pickedResult: TradeResult | null,
): number {
  if (!card || card.status !== "fixed") return 0;
  if (pickedResult !== null) return 4;
  const window = tradeWindow(card.plan.entryTime, card.plan.expiry.seconds, now);
  if (window === null) return 1;
  if (now.getTime() < window.opensAt.getTime()) return 1;
  if (now.getTime() < window.expiresAt.getTime()) return 2;
  return 3;
}

/** When the planned trade opens and expires, on the learner's clock. Null for a malformed time. */
export function tradeWindow(entryTime: string, expirySeconds: number, now: Date): { opensAt: Date; expiresAt: Date } | null {
  const match = ENTRY_TIME_RE.exec(entryTime);
  if (!match) return null;
  const [hours, minutes] = entryTime.split(":").map(Number) as [number, number];
  const opensAt = new Date(now);
  opensAt.setHours(hours, minutes, 0, 0);
  if (opensAt.getTime() - now.getTime() > 12 * 60 * 60 * 1000) opensAt.setDate(opensAt.getDate() - 1);
  return { opensAt, expiresAt: new Date(opensAt.getTime() + expirySeconds * 1000) };
}

export function hhmmss(date: Date): string {
  return `${hhmm(date)}:${String(date.getSeconds()).padStart(2, "0")}`;
}

/* ---------------------------------------------------------------- labels */

export function directionLabel(direction: TradeDirection): string {
  return direction === "up" ? "Выше" : "Ниже";
}

export function resultLabel(result: TradeResult): string {
  return result === "profit" ? "Прибыль" : "Убыток";
}

/** «Прибыль · без наблюдения», as the presentation words the saved card. */
export function savedSummary(card: Pick<TradeCard, "result" | "observation">): string {
  const result = card.result ? resultLabel(card.result) : "Без результата";
  return `${result} · ${card.observation ? "с наблюдением" : "без наблюдения"}`;
}
