/**
 * Trading Journal (L10) — finished trades, as the learner reviews them.
 *
 * THE BACKEND IS THE AUTHORITY. The rules below copy the Backend's
 * (`backend/src/lib/tools/journal.ts`) so the learner hears about a mistake
 * while typing; the Backend re-checks everything and its answer wins.
 *
 * Two sources: a Trade Card saved after the journal opened (its trade is the
 * card's and is not edited here), or a trade recorded by hand. The review —
 * plan followed or not, which rules broke, how it went, what to take from it —
 * is always the learner's.
 */
import {
  TRADE_CARD_LIMITS,
  formatMinor,
  outcomesFor,
  parseAmountToMinor,
  type TradeCardReference,
  type TradeDirection,
  type TradeResult,
} from "../trade-card/trade-card-model";
import { localDate } from "../model/local-date";

export { localDate };

/* ------------------------------------------------------------------ types */

export type JournalSource = "trade_card" | "manual";
export type JournalFilter = "all" | "violated" | "no_conclusion";

export type JournalViolation = {
  readonly code: string;
  readonly label: string;
};

export type JournalReference = TradeCardReference & {
  readonly violations: readonly JournalViolation[];
};

/** One entry exactly as the Backend sends it. */
export type JournalEntry = {
  readonly id: string;
  readonly source: JournalSource;
  readonly tradeCardId: string | null;
  readonly tradeDate: string;
  readonly entryTime: string;
  readonly asset: { readonly code: string; readonly label: string };
  readonly direction: TradeDirection;
  readonly amount: string;
  readonly payoutPercent: number;
  readonly expiry: {
    readonly code: string;
    readonly label: string;
    readonly seconds: number;
  };
  readonly result: TradeResult;
  readonly resultAmount: string;
  readonly plan: string | null;
  readonly execution: string | null;
  readonly conclusion: string | null;
  readonly planFollowed: boolean | null;
  readonly violations: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type JournalSummary = {
  readonly total: number;
  readonly onPlan: number;
  readonly violated: number;
  readonly unmarked: number;
  readonly withoutConclusion: number;
};

export type JournalPage = {
  readonly entries: readonly JournalEntry[];
  readonly nextCursor: string | null;
  readonly summary: JournalSummary;
  readonly filter: JournalFilter;
  readonly reference: JournalReference;
};

/** The learner's verdict on the plan: followed, broken, or not marked yet. */
export type PlanMark = "followed" | "broken" | "";

/** The review, as the form holds it. */
export type ReviewDraft = {
  planMark: PlanMark;
  violations: string[];
  execution: string;
  conclusion: string;
};

/** A hand-recorded trade and its review, as the form holds it. */
export type ManualDraft = ReviewDraft & {
  tradeDate: string;
  entryTime: string;
  asset: string;
  direction: TradeDirection | "";
  amount: string;
  payoutPercent: string;
  expiry: string;
  result: TradeResult | "";
  plan: string;
};

export type ManualField = keyof ManualDraft;
export type DraftErrors = Partial<Record<ManualField, string>>;

/** What the Backend accepts as a review. */
export type ReviewInput = {
  planFollowed: boolean | null;
  violations: string[];
  execution: string | null;
  conclusion: string | null;
};

/** What the Backend accepts as a hand-recorded entry. */
export type ManualInput = ReviewInput & {
  tradeDate: string;
  entryTime: string;
  asset: string;
  direction: TradeDirection;
  amount: string;
  payoutPercent: number;
  expiry: string;
  result: TradeResult;
  plan: string | null;
};

export const JOURNAL_LIMITS = {
  maxPlanLength: TRADE_CARD_LIMITS.reasonMax,
  maxExecutionLength: 2000,
  maxConclusionLength: TRADE_CARD_LIMITS.observationMax,
  minTradeDate: "2020-01-01",
} as const;

export const JOURNAL_FILTERS: readonly {
  value: JournalFilter;
  label: string;
}[] = [
  { value: "all", label: "Все" },
  { value: "violated", label: "План нарушен" },
  { value: "no_conclusion", label: "Нет вывода" },
];

/* ------------------------------------------------------------------ dates */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_FULL = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];
const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

function isRealDate(raw: string): boolean {
  const match = DATE_RE.exec(raw);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * «21 сен», or «21 сен 2025» when the year is not `yearInView` — the year of the
 * newest entry on screen, so the label never depends on a clock.
 */
export function formatTradeDate(tradeDate: string, yearInView: number | null): string {
  const match = DATE_RE.exec(tradeDate);
  if (!match) return tradeDate;
  const label = `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? match[2]}`;
  return yearInView !== null && Number(match[1]) !== yearInView ? `${label} ${match[1]}` : label;
}

/**
 * A day's heading: «21 сентября» and «воскресенье», with the year only when it
 * is not `yearInView`. The weekday comes from the date itself, never a clock.
 */
export function dayHeading(tradeDate: string, yearInView: number | null): { date: string; weekday: string } {
  const match = DATE_RE.exec(tradeDate);
  if (!match) return { date: tradeDate, weekday: "" };
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = `${day} ${MONTHS_FULL[month - 1] ?? match[2]}`;
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
  return {
    date: yearInView !== null && year !== yearInView ? `${date} ${year}` : date,
    weekday,
  };
}

/** The year of the newest entry on screen, which dates without a year belong to. */
export function yearInViewOf(entries: readonly JournalEntry[]): number | null {
  const first = entries[0];
  return first ? Number(first.tradeDate.slice(0, 4)) : null;
}

export type JournalDay = {
  readonly tradeDate: string;
  readonly entries: readonly JournalEntry[];
};

/** Consecutive entries of one date, in the order the Backend sent them. */
export function groupByDay(entries: readonly JournalEntry[]): JournalDay[] {
  const days: { tradeDate: string; entries: JournalEntry[] }[] = [];
  for (const entry of entries) {
    const last = days[days.length - 1];
    if (last && last.tradeDate === entry.tradeDate) last.entries.push(entry);
    else days.push({ tradeDate: entry.tradeDate, entries: [entry] });
  }
  return days;
}

/* ------------------------------------------------------------ the drafts */

export function planMarkOf(planFollowed: boolean | null): PlanMark {
  return planFollowed === true ? "followed" : planFollowed === false ? "broken" : "";
}

function planFollowedOf(mark: PlanMark): boolean | null {
  return mark === "followed" ? true : mark === "broken" ? false : null;
}

export function reviewDraftOf(entry: JournalEntry): ReviewDraft {
  return {
    planMark: planMarkOf(entry.planFollowed),
    violations: [...entry.violations],
    execution: entry.execution ?? "",
    conclusion: entry.conclusion ?? "",
  };
}

/** A blank hand-recorded trade, dated now on the learner's clock. */
export function emptyManualDraft(now: Date): ManualDraft {
  return {
    tradeDate: localDate(now),
    entryTime: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    asset: "",
    direction: "",
    amount: "",
    payoutPercent: "",
    expiry: "",
    result: "",
    plan: "",
    planMark: "",
    violations: [],
    execution: "",
    conclusion: "",
  };
}

export function manualDraftOf(entry: JournalEntry): ManualDraft {
  return {
    ...reviewDraftOf(entry),
    tradeDate: entry.tradeDate,
    entryTime: entry.entryTime,
    asset: entry.asset.code,
    direction: entry.direction,
    amount: entry.amount,
    payoutPercent: String(entry.payoutPercent),
    expiry: entry.expiry.code,
    result: entry.result,
    plan: entry.plan ?? "",
  };
}

const MESSAGES: Record<ManualField, string> = {
  tradeDate: "Дата сделки — не раньше 2020 года и не позже сегодняшнего дня.",
  entryTime: "Время входа в формате ЧЧ:ММ.",
  asset: "Выберите актив из списка.",
  direction: "Выберите направление: выше или ниже.",
  amount: "Сумма — число больше нуля, до двух знаков после точки.",
  payoutPercent: "Payout — целое число от 1 до 100.",
  expiry: "Выберите экспирацию.",
  result: "Отметьте результат: прибыль или убыток.",
  plan: `План — не длиннее ${JOURNAL_LIMITS.maxPlanLength} символов.`,
  planMark: "Отметьте, соблюдён ли план.",
  violations: "Нарушения отмечаются только при нарушенном плане.",
  execution: `Исполнение — не длиннее ${JOURNAL_LIMITS.maxExecutionLength} символов.`,
  conclusion: `Вывод — не длиннее ${JOURNAL_LIMITS.maxConclusionLength} символов.`,
};

export function fieldMessage(field: ManualField): string {
  return MESSAGES[field];
}

function textOrNull(raw: string): string | null {
  const text = raw.trim();
  return text.length > 0 ? text : null;
}

/** The review as the Backend accepts it; rules only ever travel with a broken plan. */
export function validateReview(
  draft: ReviewDraft,
): { ok: true; review: ReviewInput } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {};
  if (draft.execution.trim().length > JOURNAL_LIMITS.maxExecutionLength) errors.execution = MESSAGES.execution;
  if (draft.conclusion.trim().length > JOURNAL_LIMITS.maxConclusionLength) errors.conclusion = MESSAGES.conclusion;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    review: {
      planFollowed: planFollowedOf(draft.planMark),
      violations: draft.planMark === "broken" ? [...new Set(draft.violations)] : [],
      execution: textOrNull(draft.execution),
      conclusion: textOrNull(draft.conclusion),
    },
  };
}

function parsePayout(raw: string): number | null {
  const trimmed = raw.trim().replace("%", "").trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= 100 ? value : null;
}

/** A hand-recorded trade as the Backend accepts it. Every field checked at once. */
export function validateManual(
  draft: ManualDraft,
  reference: JournalReference,
  now: Date,
): { ok: true; entry: ManualInput } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {};
  // The journal records trades that already happened, so a date is at most the
  // learner's today. (The Backend allows a day more, for time zones it cannot see.)
  if (
    !isRealDate(draft.tradeDate) ||
    draft.tradeDate < JOURNAL_LIMITS.minTradeDate ||
    draft.tradeDate > localDate(now)
  ) {
    errors.tradeDate = MESSAGES.tradeDate;
  }
  if (!HHMM_RE.test(draft.entryTime.trim())) errors.entryTime = MESSAGES.entryTime;
  if (!reference.assets.some((asset) => asset.code === draft.asset)) errors.asset = MESSAGES.asset;
  if (draft.direction !== "up" && draft.direction !== "down") errors.direction = MESSAGES.direction;
  const amountMinor = parseAmountToMinor(draft.amount);
  if (amountMinor === null) errors.amount = MESSAGES.amount;
  const payout = parsePayout(draft.payoutPercent);
  if (payout === null) errors.payoutPercent = MESSAGES.payoutPercent;
  if (!reference.expiries.some((expiry) => expiry.code === draft.expiry)) errors.expiry = MESSAGES.expiry;
  if (draft.result !== "profit" && draft.result !== "loss") errors.result = MESSAGES.result;
  if (draft.plan.trim().length > JOURNAL_LIMITS.maxPlanLength) errors.plan = MESSAGES.plan;
  const review = validateReview(draft);
  if (!review.ok) Object.assign(errors, review.errors);

  if (Object.keys(errors).length > 0 || amountMinor === null || payout === null || !review.ok) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    entry: {
      tradeDate: draft.tradeDate,
      entryTime: draft.entryTime.trim(),
      asset: draft.asset,
      direction: draft.direction as TradeDirection,
      amount: formatMinor(amountMinor),
      payoutPercent: payout,
      expiry: draft.expiry,
      result: draft.result as TradeResult,
      plan: textOrNull(draft.plan),
      ...review.review,
    },
  };
}

/** The Backend names a refused field as `invalid_<field>`; map it back onto the form. */
export function fieldOfServerDetail(detail: string | null): ManualField | null {
  const map: Record<string, ManualField> = {
    invalid_tradeDate: "tradeDate",
    invalid_entryTime: "entryTime",
    invalid_asset: "asset",
    invalid_direction: "direction",
    invalid_amount: "amount",
    invalid_payoutPercent: "payoutPercent",
    invalid_expiry: "expiry",
    invalid_result: "result",
    invalid_plan: "plan",
    invalid_violations: "violations",
    invalid_execution: "execution",
    invalid_conclusion: "conclusion",
  };
  return detail ? (map[detail] ?? null) : null;
}

/* ------------------------------------------------------- list bookkeeping */

/** The Backend's order: the newest trade first — date, entry time, then when it was recorded. */
export function compareEntries(a: JournalEntry, b: JournalEntry): number {
  if (a.tradeDate !== b.tradeDate) return a.tradeDate < b.tradeDate ? 1 : -1;
  if (a.entryTime !== b.entryTime) return a.entryTime < b.entryTime ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * The loaded list with `entry` where the Backend would put it. While more pages
 * remain, an entry that sorts after the last loaded one belongs to a later page
 * and is left for it.
 */
export function placeEntry(entries: readonly JournalEntry[], entry: JournalEntry, hasMore: boolean): JournalEntry[] {
  const rest = entries.filter((current) => current.id !== entry.id);
  const last = rest[rest.length - 1];
  if (hasMore && last && compareEntries(entry, last) > 0) return rest;
  return [...rest, entry].sort(compareEntries);
}

export function matchesFilter(entry: JournalEntry, filter: JournalFilter): boolean {
  if (filter === "violated") return entry.planFollowed === false;
  if (filter === "no_conclusion") return entry.conclusion === null;
  return true;
}

/** The counts after one entry changed, without asking the Backend again. */
export function adjustSummary(summary: JournalSummary, before: JournalEntry, after: JournalEntry): JournalSummary {
  const mark = (entry: JournalEntry) => (entry.planFollowed === true ? 1 : 0);
  const broke = (entry: JournalEntry) => (entry.planFollowed === false ? 1 : 0);
  const open = (entry: JournalEntry) => (entry.conclusion === null ? 1 : 0);
  const onPlan = summary.onPlan - mark(before) + mark(after);
  const violated = summary.violated - broke(before) + broke(after);
  return {
    total: summary.total,
    onPlan,
    violated,
    unmarked: summary.total - onPlan - violated,
    withoutConclusion: summary.withoutConclusion - open(before) + open(after),
  };
}

/** The counts with one more entry. */
export function summaryWithEntry(summary: JournalSummary, entry: JournalEntry): JournalSummary {
  return {
    total: summary.total + 1,
    onPlan: summary.onPlan + (entry.planFollowed === true ? 1 : 0),
    violated: summary.violated + (entry.planFollowed === false ? 1 : 0),
    unmarked: summary.unmarked + (entry.planFollowed === null ? 1 : 0),
    withoutConclusion: summary.withoutConclusion + (entry.conclusion === null ? 1 : 0),
  };
}

/** Whether the learner has reviewed the entry at all: a mark, or any written line. */
export function isReviewed(entry: Pick<JournalEntry, "planFollowed" | "execution" | "conclusion">): boolean {
  return entry.planFollowed !== null || entry.execution !== null || entry.conclusion !== null;
}

export function planMarkLabel(planFollowed: boolean | null): string {
  return planFollowed === true ? "По плану" : planFollowed === false ? "Нарушен" : "Не отмечено";
}

/** The money of one trade, as the list shows it. */
export function resultMoney(entry: Pick<JournalEntry, "result" | "resultAmount">): {
  kind: "gain" | "loss";
  text: string;
} {
  return entry.result === "profit"
    ? { kind: "gain", text: `+$${entry.resultAmount}` }
    : { kind: "loss", text: `−$${entry.resultAmount}` };
}

/** The live outcome under a hand-recorded trade, or null while it is incomplete. */
export function draftResultMoney(draft: Pick<ManualDraft, "amount" | "payoutPercent" | "result">) {
  const amountMinor = parseAmountToMinor(draft.amount);
  const payout = parsePayout(draft.payoutPercent);
  if (amountMinor === null || payout === null || (draft.result !== "profit" && draft.result !== "loss")) return null;
  const { ifRightMinor, ifWrongMinor } = outcomesFor(amountMinor, payout);
  return resultMoney({
    result: draft.result,
    resultAmount: formatMinor(draft.result === "profit" ? ifRightMinor : ifWrongMinor),
  });
}
