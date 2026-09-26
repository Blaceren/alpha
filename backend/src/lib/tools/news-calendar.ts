/**
 * TOOLS-V2 — News Calendar (L30): the learner's news plan over the calendar.
 *
 * WHAT IT IS. The presentation's window: the day's releases in the learner's
 * own time zone, and the windows in which their plan closes entry — «Вход
 * закрыт по вашему плану до 14:45». Lessons L26–L29: the calendar, how price
 * reacts, when not to trade, and a plan made before the release comes out.
 *
 * THE PLAN IS THE LEARNER'S. Which releases close entry (high importance only,
 * or medium and high), for how many minutes before and after, for which
 * currencies, and the time zone the day is read in. Nothing is chosen for
 * them and nothing comes from another tool (owner, answer 8): until the first
 * save there is no plan and no window, only the calendar.
 *
 * THE CALENDAR IS OURS. Its rows are the published news items the copywriters
 * write in the CRM. A learner reads them and never writes one.
 *
 * KEPT IN VERSIONS, like the Risk Plan: a save adds a version, the newest is in
 * force, an identical save adds nothing, nothing is edited or deleted.
 */
import { NEWS_CURRENCIES, isNewsCurrency, newsReference } from "@/lib/news/reference";
import { isValidTimeZone } from "@/lib/news/zoned-time";
import { ToolError } from "./errors";

export const NEWS_CALENDAR_TOOL_CODE = "tool.news_calendar" as const;

export const NEWS_PLAN_MINUTES = [5, 10, 15, 30, 60] as const;
/** 3: only high-importance releases close entry. 2: medium and high. */
export const NEWS_PLAN_IMPORTANCE = [3, 2] as const;

const HOUR_MS = 60 * 60 * 1000;

export const NEWS_CALENDAR_LIMITS = {
  /** The first read covers every time zone's "today": now ± 36 h. */
  aroundNowMs: 36 * HOUR_MS,
  /** A day read by the browser, with room for the days summer time makes longer. */
  maxSpanMs: 72 * HOUR_MS,
  earliest: Date.UTC(2020, 0, 1),
  maxDaysAhead: 400,
  /** More rows than any real day has; a guard, not a page size. */
  maxEvents: 300,
} as const;

/* ---------------------------------------------------------------- the plan */

export type NewsPlanInput = {
  readonly timeZone: string;
  readonly minImportance: number;
  readonly minutesBefore: number;
  readonly minutesAfter: number;
  /** Codes in the order of `NEWS_CURRENCIES`, no repeats. */
  readonly currencies: readonly string[];
};

function fail(field: string): never {
  throw new ToolError("TOOL_VALIDATION", `invalid_${field}`);
}

function oneOf(value: unknown, allowed: readonly number[], field: string): number {
  if (typeof value !== "number" || !allowed.includes(value)) fail(field);
  return value;
}

/** `{ timeZone, minImportance, minutesBefore, minutesAfter, currencies: [...] }`. */
export function parseNewsPlan(raw: unknown): NewsPlanInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail("plan");
  const input = raw as Record<string, unknown>;
  if (!isValidTimeZone(input.timeZone)) fail("time_zone");

  const currencies = input.currencies;
  if (!Array.isArray(currencies) || currencies.length === 0 || currencies.length > NEWS_CURRENCIES.length) {
    fail("currencies");
  }
  const chosen = new Set<string>();
  for (const code of currencies) {
    if (typeof code !== "string" || !isNewsCurrency(code) || chosen.has(code)) fail("currencies");
    chosen.add(code);
  }

  return {
    timeZone: input.timeZone,
    minImportance: oneOf(input.minImportance, NEWS_PLAN_IMPORTANCE, "min_importance"),
    minutesBefore: oneOf(input.minutesBefore, NEWS_PLAN_MINUTES, "minutes_before"),
    minutesAfter: oneOf(input.minutesAfter, NEWS_PLAN_MINUTES, "minutes_after"),
    currencies: NEWS_CURRENCIES.filter((code) => chosen.has(code)),
  };
}

export function encodeCurrencies(currencies: readonly string[]): string {
  return currencies.join(",");
}

export function decodeCurrencies(stored: string): string[] {
  return stored.split(",").filter(isNewsCurrency);
}

type PlanRow = {
  readonly timeZone: string;
  readonly minImportance: number;
  readonly minutesBefore: number;
  readonly minutesAfter: number;
  readonly currencies: string;
  readonly createdAt: Date;
};

export function isSameNewsPlan(row: PlanRow, plan: NewsPlanInput): boolean {
  return (
    row.timeZone === plan.timeZone &&
    row.minImportance === plan.minImportance &&
    row.minutesBefore === plan.minutesBefore &&
    row.minutesAfter === plan.minutesAfter &&
    row.currencies === encodeCurrencies(plan.currencies)
  );
}

export function toNewsPlanDto(row: PlanRow, version: number) {
  return {
    version,
    timeZone: row.timeZone,
    minImportance: row.minImportance,
    minutesBefore: row.minutesBefore,
    minutesAfter: row.minutesAfter,
    currencies: decodeCurrencies(row.currencies),
    savedAt: row.createdAt.toISOString(),
  };
}

/* ----------------------------------------------------------- the window */

export type CalendarWindow = { readonly from: Date; readonly to: Date };

function instant(raw: string | null, field: string): number {
  // ISO 8601 with a zone, as the browser's toISOString() writes it.
  if (raw === null || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw)) fail(field);
  const value = Date.parse(raw);
  if (Number.isNaN(value)) fail(field);
  return value;
}

/**
 * No query: the first read, now ± 36 h, which holds "today" in every time zone.
 * `?from=…&to=…`: a day the browser worked out in the learner's zone.
 */
export function parseCalendarWindow(params: URLSearchParams, now: Date = new Date()): CalendarWindow {
  for (const key of params.keys()) {
    if (key !== "from" && key !== "to") throw new ToolError("TOOL_VALIDATION", "unexpected_query_parameter");
    if (params.getAll(key).length > 1) fail(key);
  }
  if (!params.has("from") && !params.has("to")) {
    return {
      from: new Date(now.getTime() - NEWS_CALENDAR_LIMITS.aroundNowMs),
      to: new Date(now.getTime() + NEWS_CALENDAR_LIMITS.aroundNowMs),
    };
  }
  const from = instant(params.get("from"), "from");
  const to = instant(params.get("to"), "to");
  const latest = now.getTime() + NEWS_CALENDAR_LIMITS.maxDaysAhead * 24 * HOUR_MS;
  if (from < NEWS_CALENDAR_LIMITS.earliest || to > latest) fail("window");
  if (to <= from || to - from > NEWS_CALENDAR_LIMITS.maxSpanMs) fail("window");
  return { from: new Date(from), to: new Date(to) };
}

/** What the plan form offers. */
export function newsCalendarReference() {
  const { currencies, importance, countries } = newsReference();
  return { currencies, importance, countries, minutes: [...NEWS_PLAN_MINUTES], planImportance: [...NEWS_PLAN_IMPORTANCE] };
}
