/**
 * Domain types for progression. Pure types + label helpers — no UI, no data.
 * Stable internal codes (level.018, rank.observer_3, tool.chart_markup) live
 * here but are NEVER rendered to the user; only human-readable RU labels are.
 */

export type RankFamily =
  | "observer"
  | "analyst"
  | "tactician"
  | "strategist"
  | "architect";

export interface Rank {
  /** Stable internal code, e.g. "rank.observer_3". Not shown to the user. */
  code: string;
  family: RankFamily;
  /** Roman tier within the family, 1–4. */
  tier: 1 | 2 | 3 | 4;
  /** Human-readable RU label, e.g. "Наблюдатель III". */
  label: string;
}

export type LevelState =
  | "hidden"
  | "locked"
  | "xp-eligible"
  | "active"
  | "in-progress"
  | "pending-review"
  | "completed"
  | "checkpoint"
  | "grace"
  | "suspended";

export type LevelActivity =
  | "lesson"
  | "test"
  | "report"
  | "practical"
  | "checkpoint";

export interface PathNodeModel {
  /** Stable internal code, e.g. "level.018". Not shown to the user. */
  code: string;
  /** 1–100. Shown to the user as a small ordinal, secondary to the reward. */
  index: number;
  state: LevelState;
  activity: LevelActivity;
  /** Optional short RU label (lesson/checkpoint name) for the current node. */
  label?: string;
  /** Optional reward RU label attached to the node (visually primary). */
  reward?: string;
}

export interface ModuleProgressModel {
  /** RU module name from the curriculum, e.g. "Чтение графика". */
  name: string;
  /** 1-based module ordinal for context, e.g. 4. */
  ordinal: number;
  completedLevels: number;
  totalLevels: number;
}

export interface CheckpointTargetModel {
  /** Level ordinal of the checkpoint, e.g. 20. */
  levelIndex: number;
  /** Provisional: minimum required Pocket balance target, e.g. 200 (USD). */
  targetUsd: number;
  /** RU label of the rank unlocked at this checkpoint. */
  rankLabel: string;
}

export type ToolState = "available" | "locked" | "nearest-reward";

export interface ToolModel {
  /** Stable internal code, e.g. "tool.trading_journal". Not shown to user. */
  code: string;
  /** English tool name (kept), shown alongside a RU description. */
  name: string;
  /** Short RU description shown next to the English name. */
  description: string;
  /** Unlock level ordinal. */
  unlockLevel: number;
  state: ToolState;
}

export interface StreakModel {
  /** Current streak length in meaningful learning actions. */
  current: number;
  /** Best streak achieved (never punished on reset). */
  best: number;
  active: boolean;
}

export interface AlexMessageModel {
  /** Short RU message from Alex Curie. No profit promises. */
  text: string;
}

export interface PrimaryActionModel {
  /** RU CTA label, e.g. "Продолжить урок". */
  label: string;
  /** RU supporting context, e.g. lesson name. */
  context: string;
  kind: "continue-lesson" | "start-test" | "fix-report" | "checkpoint";
}

export interface DashboardState {
  user: { greeting: string };
  rank: Rank;
  level: {
    index: number;
    /** RU lesson name, e.g. "Поддержка и сопротивление". */
    lessonName: string;
  };
  module: ModuleProgressModel;
  xp: { current: number; label: string };
  streak: StreakModel;
  primaryAction: PrimaryActionModel;
  path: PathNodeModel[];
  nextCheckpoint: CheckpointTargetModel;
  nearestReward: ToolModel;
  tools: ToolModel[];
  alex: AlexMessageModel;
}

const RANK_FAMILY_LABEL: Record<RankFamily, string> = {
  observer: "Наблюдатель",
  analyst: "Аналитик",
  tactician: "Тактик",
  strategist: "Стратег",
  architect: "Архитектор рынка",
};

const ROMAN: Record<1 | 2 | 3 | 4, string> = { 1: "I", 2: "II", 3: "III", 4: "IV" };

/** Build a human-readable RU rank label from family + tier. */
export function rankLabel(family: RankFamily, tier: 1 | 2 | 3 | 4): string {
  return `${RANK_FAMILY_LABEL[family]} ${ROMAN[tier]}`;
}
