/**
 * Path scenario adapter (Phase D2A). Derives per-level UI state from a mock
 * progress marker — progress is NEVER stored on curriculum data itself, so the
 * same adapter later swaps to real backend progress without touching the UI.
 *
 * Deterministic dev scenarios via /path?scenario=…; unknown → "active".
 * The scenario mechanism is invisible to the user (no debug controls).
 */

import type { CurriculumLevel } from "@/domain/curriculum";
import { getLevel, getModuleByIndex, getModuleForLevel } from "@/data/curriculum/fixture";

export type PathScenario =
  | "active"
  | "checkpoint"
  | "early"
  | "advanced"
  | "completed"
  | "report";

/** Sequential progress marker: everything below `currentLevel` is completed. */
export interface PathProgress {
  scenario: PathScenario;
  /** The level the user is on right now (1–100). */
  currentLevel: number;
  /** True when every level (1–100) is completed. */
  allCompleted: boolean;
  /** Instrumentation shown in the header (mock, matches the Home canon). */
  rankLabel: string;
  xpLabel: string;
  streak: number;
}

/** Core progression state of one level relative to the progress marker. */
export type LevelProgressState = "completed" | "current" | "available" | "locked";

/** Full visual state — progression state refined by checkpoint semantics. */
export type LevelVisualState =
  | LevelProgressState
  | "checkpoint-completed"
  | "checkpoint-current"
  | "checkpoint-ahead";

/** Secondary, non-exclusive markers attached to a level. */
export type LevelTrait =
  | "tool-unlock"
  | "community-unlock"
  | "report-required"
  | "mentor-review-required"
  | "module-start"
  | "module-complete";

export function resolvePathScenario(raw: unknown): PathScenario {
  switch (raw) {
    case "checkpoint":
    case "early":
    case "advanced":
    case "completed":
    case "report":
      return raw;
    default:
      return "active";
  }
}

/** Canonical mock user (Артём) — instrumentation matches the Home canon. */
const BASE = { rankLabel: "Наблюдатель III", xpLabel: "2 480 XP", streak: 6 };

const SCENARIOS: Record<PathScenario, PathProgress> = {
  // L18 «Поддержка и сопротивление», module 4, пройдено 2 из 5.
  active: { scenario: "active", currentLevel: 18, allCompleted: false, ...BASE },
  // Learning of module 4 done; the L20 gate itself is the current step.
  checkpoint: { scenario: "checkpoint", currentLevel: 20, allCompleted: false, ...BASE },
  // Fresh start: L1 done, L2 current.
  early: {
    scenario: "early",
    currentLevel: 2,
    allCompleted: false,
    rankLabel: "Без ранга",
    xpLabel: "40 XP",
    streak: 1,
  },
  // Near the end: the L85 gate (module 17 «Кейсы») is the current step.
  advanced: {
    scenario: "advanced",
    currentLevel: 85,
    allCompleted: false,
    rankLabel: "Стратег IV",
    xpLabel: "16 900 XP",
    streak: 12,
  },
  // Everything done.
  completed: {
    scenario: "completed",
    currentLevel: 100,
    allCompleted: true,
    rankLabel: "Архитектор рынка IV",
    xpLabel: "24 000 XP",
    streak: 21,
  },
  /**
   * The report level (L3) is the current step — the ONLY marker under which the
   * report story is coherent (D3-B).
   *
   * Why this exists: the canonical user (Артём) stands on level 18, so for him
   * level 3 is long behind and level 4 is a passed checkpoint. «Submit → pending
   * → level 4 stays closed» is only true for someone standing ON level 3. Rather
   * than rewrite the locked canon (DD-234) or let a report retroactively close
   * levels 4–18, D3-B adds this explicit scenario alongside the existing
   * early/advanced/checkpoint ones (DD-271).
   *
   * It is a DEVELOPMENT AND TEST adapter, exactly like its siblings: invisible to
   * the user, never emitted into a user-facing href, never a progression
   * mechanism, and never enabled automatically.
   *
   * Instrumentation is copied verbatim from `early` rather than invented: there
   * is no canonical XP rule for reaching level 3, and DD-250 forbids making one up.
   */
  report: {
    scenario: "report",
    currentLevel: 3,
    allCompleted: false,
    rankLabel: "Без ранга",
    xpLabel: "40 XP",
    streak: 1,
  },
};

export function getPathProgress(scenario: PathScenario): PathProgress {
  return SCENARIOS[scenario];
}

/** Core progression state for a level number under the given progress. */
export function levelProgressState(
  level: number,
  progress: PathProgress,
): LevelProgressState {
  if (progress.allCompleted) return "completed";
  if (level < progress.currentLevel) return "completed";
  if (level === progress.currentLevel) return "current";
  if (level === progress.currentLevel + 1) return "available";
  return "locked";
}

/** Visual state: progression state refined for checkpoint levels. */
export function levelVisualState(
  level: CurriculumLevel,
  progress: PathProgress,
): LevelVisualState {
  const base = levelProgressState(level.number, progress);
  if (level.kind !== "checkpoint") return base;
  if (base === "completed") return "checkpoint-completed";
  if (base === "current") return "checkpoint-current";
  // Any not-yet-reached checkpoint reads as a gate ahead (incl. "available").
  return "checkpoint-ahead";
}

/** Non-exclusive trait markers for a level. */
export function levelTraits(level: CurriculumLevel): LevelTrait[] {
  const traits: LevelTrait[] = [];
  const mod = getModuleForLevel(level.number);
  if (level.number === mod.startLevel) traits.push("module-start");
  if (level.number === mod.endLevel) traits.push("module-complete");
  if (level.checkpoint?.toolUnlock) traits.push("tool-unlock");
  if (level.checkpoint?.communityUnlock) traits.push("community-unlock");
  if (level.artifact && level.kind !== "task") traits.push("report-required");
  if (level.mentorReview) traits.push("mentor-review-required");
  return traits;
}

/** Human-readable RU state label — state is never conveyed by colour alone. */
export function stateLabel(state: LevelVisualState): string {
  switch (state) {
    case "completed":
      return "пройден";
    case "current":
      return "текущий";
    case "available":
      return "следующий";
    case "locked":
      return "закрыт";
    case "checkpoint-completed":
      return "контрольная точка пройдена";
    case "checkpoint-current":
      return "текущая контрольная точка";
    case "checkpoint-ahead":
      return "контрольная точка впереди";
  }
}

/** Why a locked level is locked, in plain RU (for the detail explainer). */
export function lockedReason(level: CurriculumLevel, progress: PathProgress): string {
  const current = getLevel(progress.currentLevel);
  const gate = getModuleForLevel(progress.currentLevel).checkpoint;
  if (level.number > gate.level) {
    return `Уровень откроется после контрольной точки · Уровень ${gate.level}.`;
  }
  return `Уровень откроется после уровня ${current.number} «${current.title}».`;
}

/** Module aggregate state for the navigator. */
export type ModuleAggregateState = "completed" | "current" | "upcoming" | "locked";

export function moduleAggregateState(
  moduleIndex: number,
  progress: PathProgress,
): ModuleAggregateState {
  const mod = getModuleByIndex(moduleIndex);
  if (progress.allCompleted || progress.currentLevel > mod.endLevel) return "completed";
  if (progress.currentLevel >= mod.startLevel) return "current";
  if (moduleIndex === getModuleForLevel(progress.currentLevel).index + 1) return "upcoming";
  return "locked";
}

/** Completed level count within a module (for "пройдено X из Y"). */
export function moduleCompletedCount(moduleIndex: number, progress: PathProgress): number {
  const mod = getModuleByIndex(moduleIndex);
  if (progress.allCompleted) return mod.levels.length;
  const done = Math.min(Math.max(progress.currentLevel - mod.startLevel, 0), mod.levels.length);
  return done;
}
