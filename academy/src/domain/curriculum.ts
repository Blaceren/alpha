/**
 * Curriculum domain types (Phase D2A). Pure types — no UI, no data, no progress.
 * Canonical sources: les-prog.txt + docs/CURRICULUM_AND_UNLOCKS.md.
 * Stable codes (level.018, module.04, tool.chart_markup) are NEVER rendered to
 * the user — only human-readable RU labels are.
 *
 * Progress/state is NOT stored here: level state is derived by the scenario
 * adapter (src/features/path/model/path-state.ts) from a mock progress marker.
 */

import type { RankFamily } from "@/domain/progression";

/** Activity kind of a level, from the canonical mapping table. */
export type CurriculumLevelKind =
  | "task"
  | "video-test"
  | "report"
  | "practical"
  | "checkpoint";

export interface RankTransition {
  /** Stable code, e.g. "rank.observer_4". */
  code: string;
  family: RankFamily;
  tier: 1 | 2 | 3 | 4;
  /** RU label, e.g. "Наблюдатель IV". */
  label: string;
}

export interface ToolUnlock {
  /** Stable code, e.g. "tool.chart_markup". */
  code: string;
  /** Tool name (English kept as domain language), e.g. "Chart Markup Tool". */
  name: string;
  /** Unlock level number. */
  unlockLevel: number;
}

export interface CommunityUnlock {
  /** Stable code, e.g. "channel.chart_review". */
  code: string;
  /** RU channel name, e.g. "Разбор графиков". */
  name: string;
  unlockLevel: number;
}

export interface CheckpointDefinition {
  /** Stable code, e.g. "checkpoint.020". */
  code: string;
  /** Level number the checkpoint lives on (module's last level). */
  level: number;
  /** Minimum required REAL Pocket balance (USD). Target only — never the user's balance. */
  thresholdUsd: number;
  rank: RankTransition;
  /** Absent only on checkpoint.004 (L4). */
  toolUnlock?: ToolUnlock;
  communityUnlock?: CommunityUnlock;
}

/** A structured report / practical artifact required by a level. */
export interface ReportRequirement {
  levelNumber: number;
  /** Short RU artifact label, e.g. "Разметка 3 графиков". */
  artifact: string;
}

/** A mandatory mentor review attached to a level. */
export interface MentorReviewRequirement {
  levelNumber: number;
}

export interface CurriculumLevel {
  /** Stable code "level.001"…"level.100". */
  code: string;
  /** 1–100. */
  number: number;
  /** Canonical RU lesson title. */
  title: string;
  /** Owning module code, e.g. "module.04". */
  moduleCode: string;
  kind: CurriculumLevelKind;
  /** Required artifact (report/practical levels). */
  artifact?: string;
  /** True when mentor review is mandatory for this level. */
  mentorReview: boolean;
  /** Present only on checkpoint levels. */
  checkpoint?: CheckpointDefinition;
}

export interface CurriculumModule {
  /** Stable code "module.01"…"module.20". */
  code: string;
  /** 1–20. */
  index: number;
  /** Canonical RU module title, e.g. "Чтение графика". */
  title: string;
  /** Short RU description (UI copy; meaning follows les-prog.txt). */
  description: string;
  startLevel: number;
  endLevel: number;
  levels: CurriculumLevel[];
  /** The module's closing checkpoint (its last level). */
  checkpoint: CheckpointDefinition;
}

export interface Curriculum {
  modules: CurriculumModule[];
  /** Flat index 1..100 for direct lookup. */
  levels: CurriculumLevel[];
}

/** Format a checkpoint threshold for UI: "$1 500" (NBSP thousands, no cents).
 *  Deterministic (no locale dependence) so tests and screenshots are stable. */
export function formatThresholdUsd(value: number): string {
  const grouped = value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `$${grouped}`;
}
