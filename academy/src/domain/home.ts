/**
 * Domain types for the Route Field Home. Pure types — no UI, no data.
 * Two deterministic scenarios: active lesson and current checkpoint.
 * Canonical names come from les-prog.txt (Module 4 «Чтение графика», levels 16–20).
 */

import { rankLabel } from "@/domain/progression";

export type HomeScenario = "active" | "checkpoint";

export type RouteNodeState =
  | "completed"
  | "current"
  | "upcoming"
  | "locked"
  | "checkpoint";

export interface RouteNodeModel {
  index: number;
  state: RouteNodeState;
  /** Short RU label (lesson/checkpoint name) for the screen-reader alternative. */
  label: string;
}

export interface ModuleContext {
  ordinal: number;
  name: string;
  completed: number;
  total: number;
}

export interface LessonContext {
  levelIndex: number;
  title: string;
  module: ModuleContext;
}

export interface CheckpointModel {
  levelIndex: number;
  /** Provisional minimum required Pocket balance target (USD). Never the user's balance. */
  requirementUsd: number;
  nextRankLabel: string;
  unlockToolName: string;
}

export interface Instrumentation {
  /** Provisional rank label, e.g. "Наблюдатель III". */
  rankLabel: string;
  xp: number;
  xpLabel: string;
  streakCurrent: number;
}

export interface MentorMessage {
  /** 1–3 line contextual message. No profit promises, no financial pressure. */
  text: string;
}

export interface PrimaryActionModel {
  label: string;
  kind: "continue-lesson" | "verify-checkpoint";
}

export interface HomeState {
  scenario: HomeScenario;
  user: { name: string; greeting: string };
  instrumentation: Instrumentation;
  lesson: LessonContext;
  /** The immediate next learning node (level 19). */
  upcomingLevelIndex: number;
  checkpoint: CheckpointModel;
  mentor: MentorMessage;
  /** Fragment of the route around the current position (15–21). */
  route: RouteNodeModel[];
  primaryAction: PrimaryActionModel;
  toolsAvailable: string[];
}

/** Resolve a scenario from a raw query value; unknown safely falls back to active. */
export function resolveScenario(raw: unknown): HomeScenario {
  return raw === "checkpoint" ? "checkpoint" : "active";
}

export { rankLabel };
