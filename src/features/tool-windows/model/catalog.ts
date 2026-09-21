/**
 * TOOLS-V2 — the six learner tools, in the order they open.
 *
 * WHAT CHANGED. The previous catalogue was nineteen tools read off the
 * checkpoint rows, two of them built and seventeen announcements. The owner
 * replaced it on 2026-09-21 with a first block of six, taken from the
 * presentation «Окна инструментов ATA»:
 *
 *   L5  Trade Card       released by the L5 LESSON «Жизненный цикл сделки»
 *   L10 Trading Journal  released by the L10 checkpoint
 *   L15 Risk Calculator  released by the L15 checkpoint
 *   L20 Entry Checklist  released by the L20 checkpoint
 *   L25 Personal Stats   released by the L25 checkpoint
 *   L30 News Calendar    released by the L30 checkpoint
 *
 * The Trade Card is why this list cannot be derived from `CHECKPOINT_ROWS` any
 * more: a lesson has no checkpoint row. The Backend's `CURRICULUM_TOOLS` holds
 * the same six codes at the same levels, and `catalog.test.ts` pins that.
 *
 * WHAT THIS FILE DOES NOT DECIDE. Whether a tool is open. That is the Backend's
 * verdict on the curriculum read (`toolAccess`), and nothing in the Academy
 * re-derives it from a level number. This file only says what each tool is
 * called, where it lives, and whether this build contains its window.
 *
 * `code` is the Backend's canonical code; `slug` is the address a learner
 * sees, `/tools/<slug>`, the same shape the presentation uses.
 */

export type ToolSlug =
  | "trade-card"
  | "journal"
  | "risk-calculator"
  | "entry-checklist"
  | "stats"
  | "news";

export interface ToolWindowDefinition {
  /** Canonical Backend code, e.g. `tool.trade_card`. */
  readonly code: string;
  /** The address segment: `/tools/<slug>`. */
  readonly slug: ToolSlug;
  /** Domain name, English as in the curriculum and the Backend vocabulary. */
  readonly title: string;
  /** One line, from the presentation. Never a financial promise. */
  readonly description: string;
  /** The level whose completion releases the tool. Access is still the Backend's call. */
  readonly unlockLevel: number;
  /** What releases it: an ordinary lesson (the Trade Card) or a checkpoint. */
  readonly releasedBy: "lesson" | "checkpoint";
  /** Whether this build contains the tool's window. */
  readonly built: boolean;
}

export const TOOL_WINDOWS: readonly ToolWindowDefinition[] = [
  {
    code: "tool.trade_card",
    slug: "trade-card",
    title: "Trade Card",
    description: "План сделки до входа: актив, направление, сумма, payout, экспирация и причина.",
    unlockLevel: 5,
    releasedBy: "lesson",
    built: true,
  },
  {
    code: "tool.trading_journal",
    slug: "journal",
    title: "Trading Journal",
    description: "Ручной разбор отдельных сделок: план, исполнение и вывод.",
    unlockLevel: 10,
    releasedBy: "checkpoint",
    built: true,
  },
  {
    code: "tool.risk_calculator",
    slug: "risk-calculator",
    title: "Risk Calculator",
    description: "Сумма сделки и дневной лимит по капиталу, доле риска и payout.",
    unlockLevel: 15,
    releasedBy: "checkpoint",
    built: true,
  },
  {
    code: "tool.entry_checklist",
    slug: "entry-checklist",
    title: "Entry Checklist",
    description: "Условия допуска перед входом: среда, setup и собственное состояние.",
    unlockLevel: 20,
    releasedBy: "checkpoint",
    built: true,
  },
  {
    code: "tool.personal_stats",
    slug: "stats",
    title: "Personal Stats",
    description: "Win rate, соблюдение плана и нарушения по записям журнала.",
    unlockLevel: 25,
    releasedBy: "checkpoint",
    built: false,
  },
  {
    code: "tool.news_calendar",
    slug: "news",
    title: "News Calendar",
    description: "События дня в вашем часовом поясе и окна, когда вход закрыт по плану.",
    unlockLevel: 30,
    releasedBy: "checkpoint",
    built: false,
  },
];

export function toolWindowBySlug(slug: string): ToolWindowDefinition | null {
  return TOOL_WINDOWS.find((tool) => tool.slug === slug) ?? null;
}

export function toolWindowByCode(code: string): ToolWindowDefinition | null {
  return TOOL_WINDOWS.find((tool) => tool.code === code) ?? null;
}

/** The one place a tool's address is built. */
export function toolWindowHref(slug: ToolSlug): string {
  return `/tools/${slug}`;
}

/**
 * Codes the previous catalogue used and published lesson content still names.
 * A link to one of them lands on the tools page instead of a dead end: the tool
 * it named is not part of the product any more.
 */
export const RETIRED_TOOL_CODES: readonly string[] = [
  "tool.chart_markup",
  "tool.indicator_checklist",
  "tool.pause_mode",
  "tool.weekly_review",
  "tool.strategy_builder",
  "tool.capital_plan",
  "tool.market_regime_board",
  "tool.session_planner",
  "tool.strategy_statistics",
  "tool.watchlist",
  "tool.psychology_checkin",
  "tool.habit_calendar",
  "tool.mentor_case_room",
  "tool.performance_dashboard",
  "tool.personal_playbook",
  "tool.pro_workspace",
];
