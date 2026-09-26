/**
 * Personal Stats (L25) — what the learner's own Trading Journal says, split by
 * plan compliance.
 *
 * THE BACKEND COMPUTES EVERY FIGURE (`backend/src/lib/tools/stats.ts`); this
 * file only names the periods and says the figures in words. Counts and shares
 * only, never money: the owner allowed win rate and percentages for this tool
 * (2026-09-21), and nothing here adds up a stake or a result (DD-304).
 */

export type StatsPeriod = "7d" | "30d" | "all";

export type WinRate = {
  readonly trades: number;
  readonly wins: number;
  readonly winRateBasisPoints: number | null;
};

/** The window's figures, exactly as the Backend sends them. */
export type JournalStats = WinRate & {
  readonly period: StatsPeriod;
  readonly window: { readonly from: string; readonly to: string } | null;
  readonly averagePayoutTenths: number | null;
  readonly breakEvenBasisPoints: number | null;
  readonly onPlan: number;
  readonly onPlanBasisPoints: number | null;
  readonly unmarked: number;
  readonly split: { readonly followed: WinRate; readonly broken: WinRate };
  readonly violations: {
    readonly total: number;
    readonly items: ReadonlyArray<{ readonly code: string; readonly label: string; readonly count: number }>;
  };
  readonly preliminary: boolean;
  readonly minSample: number;
};

export const STATS_PERIODS: readonly { value: StatsPeriod; label: string }[] = [
  { value: "7d", label: "7 дней" },
  { value: "30d", label: "30 дней" },
  { value: "all", label: "Всё время" },
];

/* ------------------------------------------------------------------ words */

/** «55%»: a rate, whole percent, as the presentation shows it. */
export function rateWords(basisPoints: number | null): string {
  return basisPoints === null ? "—" : `${Math.round(basisPoints / 100)}%`;
}

/** «53.2%»: break-even keeps one decimal, because it is the line rates are read against. */
export function preciseWords(basisPoints: number | null): string {
  if (basisPoints === null) return "—";
  const tenths = Math.round(basisPoints / 10);
  return tenths % 10 === 0 ? `${tenths / 10}%` : `${(tenths / 10).toFixed(1)}%`;
}

/** «88%», «87.5%». */
export function payoutWords(tenths: number | null): string {
  if (tenths === null) return "—";
  return tenths % 10 === 0 ? `${tenths / 10}%` : `${(tenths / 10).toFixed(1)}%`;
}

const plural = new Intl.PluralRules("ru");

/** «1 сделка», «3 сделки», «38 сделок». */
export function tradesWords(count: number): string {
  const form = plural.select(count);
  return `${count} ${form === "one" ? "сделка" : form === "few" ? "сделки" : "сделок"}`;
}

/** «21 из 38». */
export function ofWords(part: number, whole: number): string {
  return `${part} из ${whole}`;
}

/** «Выборка — 38 сделок, выводы предварительные.» */
export function sampleWords(trades: number): string {
  return `Выборка — ${tradesWords(trades)}, выводы предварительные.`;
}

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** «15–21 сентября», «24 августа – 22 сентября», or null for all time. */
export function windowWords(window: JournalStats["window"]): string | null {
  if (!window) return null;
  const parse = (date: string) => ({ year: date.slice(0, 4), month: Number(date.slice(5, 7)) - 1, day: Number(date.slice(8, 10)) });
  const from = parse(window.from);
  const to = parse(window.to);
  if (from.year === to.year && from.month === to.month) return `${from.day}–${to.day} ${MONTHS[to.month]}`;
  return `${from.day} ${MONTHS[from.month]} – ${to.day} ${MONTHS[to.month]}`;
}

/**
 * Below this many trades a side of the split is shown without a verdict: one
 * lucky trade with a broken plan must not read as «нарушать выгодно».
 */
export const MIN_GROUP_TRADES = 5;

/**
 * Where a side's win rate stands against break-even: above it the plan earns on
 * average, below it it loses; «few» when the side has too few trades to say.
 * Null when there is nothing to compare.
 */
export function againstBreakEven(
  group: { trades: number; winRateBasisPoints: number | null },
  breakEven: number | null,
): "above" | "below" | "few" | null {
  if (group.winRateBasisPoints === null || breakEven === null) return null;
  if (group.trades < MIN_GROUP_TRADES) return "few";
  return group.winRateBasisPoints >= breakEven ? "above" : "below";
}
