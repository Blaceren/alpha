/**
 * TOOLS-V2 — Personal Stats (L25): what the learner's own Trading Journal says,
 * split by plan compliance.
 *
 * WHAT IT IS. The presentation's window, over 7 days, 30 days or all time:
 *   - the trades in the journal and their win rate;
 *   - the break-even win rate at the average payout, 1 / (1 + payout);
 *   - the share of trades on plan;
 *   - the win rate of trades on plan against trades with a broken plan, each
 *     measured against break-even;
 *   - which rules broke, how often.
 * Fewer than fifty trades is called a preliminary sample.
 *
 * COUNTS AND SHARES, NEVER MONEY. The owner allowed win rate and percentages
 * for this tool (2026-09-21, lifting DD-303's ban for Personal Stats only).
 * Nothing here adds up a stake, a result or a balance: every figure is a count
 * of journal entries or a share of them, so DD-304 still holds.
 *
 * ONLY THE JOURNAL. Every number comes from the learner's own journal entries
 * and the rules they marked themselves. Nothing comes from Pocket.
 */
import { ToolError } from "./errors";
import { parseTradeDate, utcDate } from "./dates";
import { JOURNAL_VIOLATIONS } from "./journal";

export const PERSONAL_STATS_TOOL_CODE = "tool.personal_stats" as const;

export const STATS_PERIODS = ["7d", "30d", "all"] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

const PERIOD_DAYS: Record<Exclude<StatsPeriod, "all">, number> = { "7d": 7, "30d": 30 };

export const STATS_LIMITS = {
  /** Below this many trades the window says its conclusions are preliminary. */
  minSample: 50,
} as const;

/* -------------------------------------------------------------- the query */

export type StatsQuery = {
  readonly period: StatsPeriod;
  /** The learner's calendar days the window covers, both ends included; null for all time. */
  readonly window: { readonly from: string; readonly to: string } | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date: string, days: number): string {
  return utcDate(new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS));
}

/**
 * `?period=7d|30d|all&today=YYYY-MM-DD`, and nothing else. The learner's today
 * comes from their own clock; it must be a real date within a day of the UTC
 * date, which covers every time zone. 7 and 30 days need it; all time does not.
 */
export function parseStatsQuery(params: URLSearchParams, now: Date = new Date()): StatsQuery {
  for (const key of params.keys()) {
    if (key !== "period" && key !== "today") throw new ToolError("TOOL_VALIDATION", "unexpected_query_parameter");
    if (params.getAll(key).length > 1) throw new ToolError("TOOL_VALIDATION", `invalid_${key}`);
  }
  const period = params.get("period") ?? "all";
  if (!(STATS_PERIODS as readonly string[]).includes(period)) throw new ToolError("TOOL_VALIDATION", "invalid_period");

  const todayRaw = params.get("today");
  let today: string | null = null;
  if (todayRaw !== null) {
    const utcToday = utcDate(now);
    const plausible =
      parseTradeDate(todayRaw) !== null && todayRaw >= addDays(utcToday, -1) && todayRaw <= addDays(utcToday, 1);
    if (!plausible) throw new ToolError("TOOL_VALIDATION", "invalid_today");
    today = todayRaw;
  }

  if (period === "all") return { period, window: null };
  if (today === null) throw new ToolError("TOOL_VALIDATION", "invalid_today");
  const days = PERIOD_DAYS[period as Exclude<StatsPeriod, "all">];
  return { period: period as StatsPeriod, window: { from: addDays(today, -(days - 1)), to: today } };
}

/* ------------------------------------------------------------ the figures */

export type StatsEntry = {
  readonly result: string;
  readonly planFollowed: boolean | null;
  readonly payoutPercent: number;
  readonly violations: readonly { readonly code: string }[];
};

/** Trades, wins and their win rate; the rate is null for no trades. */
export type WinRate = {
  readonly trades: number;
  readonly wins: number;
  /** Hundredths of a percent: 21 of 38 → 5526. */
  readonly winRateBasisPoints: number | null;
};

export type JournalStats = WinRate & {
  /** The average payout, in tenths of a percent: 88% → 880. Null for no trades. */
  readonly averagePayoutTenths: number | null;
  /** 1 / (1 + average payout), in hundredths of a percent. Null for no trades. */
  readonly breakEvenBasisPoints: number | null;
  /** Trades the learner marked «по плану», and the share of all trades they are. */
  readonly onPlan: number;
  readonly onPlanBasisPoints: number | null;
  /** Trades the learner has not marked yet: in the totals, in neither side of the split. */
  readonly unmarked: number;
  readonly split: { readonly followed: WinRate; readonly broken: WinRate };
  /** Rule marks by rule, most frequent first; one trade can carry several. */
  readonly violations: { readonly total: number; readonly items: readonly { code: string; label: string; count: number }[] };
  /** Fewer than `STATS_LIMITS.minSample` trades. */
  readonly preliminary: boolean;
};

function share(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part * 10_000) / whole);
}

function winRate(entries: readonly StatsEntry[]): WinRate {
  const wins = entries.filter((entry) => entry.result === "profit").length;
  return { trades: entries.length, wins, winRateBasisPoints: share(wins, entries.length) };
}

const VIOLATION_ORDER = new Map<string, number>(JOURNAL_VIOLATIONS.map((violation, index) => [violation.code, index]));
const VIOLATION_LABEL = new Map<string, string>(JOURNAL_VIOLATIONS.map((violation) => [violation.code, violation.label]));

export function computeStats(entries: readonly StatsEntry[]): JournalStats {
  const trades = entries.length;
  const payoutSum = entries.reduce((sum, entry) => sum + entry.payoutPercent, 0);
  const followed = entries.filter((entry) => entry.planFollowed === true);
  const broken = entries.filter((entry) => entry.planFollowed === false);

  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const violation of entry.violations) counts.set(violation.code, (counts.get(violation.code) ?? 0) + 1);
  }
  const items = [...counts.entries()]
    .map(([code, count]) => ({ code, label: VIOLATION_LABEL.get(code) ?? code, count }))
    .sort(
      (left, right) =>
        right.count - left.count || (VIOLATION_ORDER.get(left.code) ?? 99) - (VIOLATION_ORDER.get(right.code) ?? 99),
    );

  return {
    ...winRate(entries),
    averagePayoutTenths: trades === 0 ? null : Math.round((payoutSum * 10) / trades),
    // 1 / (1 + p/100) with p the exact average: 10000 × 100·n / (100·n + Σp).
    breakEvenBasisPoints: trades === 0 ? null : Math.round((1_000_000 * trades) / (100 * trades + payoutSum)),
    onPlan: followed.length,
    onPlanBasisPoints: share(followed.length, trades),
    unmarked: trades - followed.length - broken.length,
    split: { followed: winRate(followed), broken: winRate(broken) },
    violations: { total: items.reduce((sum, item) => sum + item.count, 0), items },
    preliminary: trades < STATS_LIMITS.minSample,
  };
}

/** What the window sends: the period it covers and the figures. */
export type JournalStatsDto = JournalStats & {
  readonly period: StatsPeriod;
  readonly window: StatsQuery["window"];
  readonly minSample: number;
};

export function toJournalStatsDto(query: StatsQuery, stats: JournalStats): JournalStatsDto {
  return { ...stats, period: query.period, window: query.window, minSample: STATS_LIMITS.minSample };
}
