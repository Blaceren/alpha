/**
 * The canonical tool verdict, for fixture mode only.
 *
 * TOOLS-AUTHORITY-DIVERGENCE-1 moved every access decision to the Backend. In
 * API mode the verdict arrives on the curriculum read. Fixture mode has no
 * Backend, so it needs a verdict of its own — and the one thing it must NOT do
 * is compute one from the scenario's progression, because that would rebuild
 * the local rule this phase removed and give the prototype a second authority.
 *
 * So each scenario STATES which tools are open, by code. The lists are literal
 * on purpose: reading one tells you what that scenario claims, and changing
 * what a scenario claims is an edit here rather than a side effect of moving a
 * level number somewhere else.
 *
 * The unlock level and the identity still come from the catalogue, which is the
 * curriculum's own table. Only "is it open" is stated here.
 */
import { TOOL_DEFINITIONS } from "@/features/tools/model/tool-catalog";
import type { PathScenario } from "@/features/path/model/path-state";
import type { AcademyToolAccess } from "@/lib/curriculum/academy-view";

/**
 * Which tools each prototype scenario shows as open.
 *
 * These match what the scenarios used to produce through the old level join, so
 * the prototype looks the same as it did — but they are now a declaration
 * rather than a derivation, and they can be changed one scenario at a time.
 */
const FIXTURE_UNLOCKED: Record<PathScenario, readonly string[]> = {
  // Level 18: past the L10 and L15 checkpoints, short of L20.
  active: ["tool.trading_journal", "tool.risk_calculator"],
  // Level 20: standing ON the checkpoint, which does not open it.
  checkpoint: ["tool.trading_journal", "tool.risk_calculator"],
  // Level 2: nothing earned yet.
  early: [],
  // Level 3.
  report: [],
  // Level 85: everything through L80.
  advanced: [
    "tool.trading_journal",
    "tool.risk_calculator",
    "tool.chart_markup",
    "tool.indicator_checklist",
    "tool.news_calendar",
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
  ],
  // The whole programme finished.
  completed: TOOL_DEFINITIONS.map((tool) => tool.id),
};

export function fixtureToolAccess(scenario: PathScenario): AcademyToolAccess {
  const open = new Set(FIXTURE_UNLOCKED[scenario]);
  const tools = TOOL_DEFINITIONS.map((tool) => ({
    code: tool.id,
    unlocked: open.has(tool.id),
    unlockLevel: tool.unlockLevel,
  }));
  return {
    total: tools.length,
    unlockedCount: tools.filter((tool) => tool.unlocked).length,
    tools,
  };
}

/**
 * A verdict stated by level, for tests that describe a learner by where they
 * stand. This is NOT the access rule: it is a convenience for writing "the
 * Backend said these are open", and the truth matrix deliberately uses cases
 * where it and the local join disagree.
 */
export function toolAccessUnlockedThrough(level: number): AcademyToolAccess {
  const tools = TOOL_DEFINITIONS.map((tool) => ({
    code: tool.id,
    unlocked: tool.unlockLevel < level,
    unlockLevel: tool.unlockLevel,
  }));
  return { total: tools.length, unlockedCount: tools.filter((t) => t.unlocked).length, tools };
}

/** A verdict that opens exactly the named codes and nothing else. */
export function toolAccessOpening(codes: readonly string[]): AcademyToolAccess {
  const open = new Set(codes);
  const tools = TOOL_DEFINITIONS.map((tool) => ({
    code: tool.id,
    unlocked: open.has(tool.id),
    unlockLevel: tool.unlockLevel,
  }));
  return { total: tools.length, unlockedCount: tools.filter((t) => t.unlocked).length, tools };
}
