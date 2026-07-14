/**
 * Single typed synthetic-state source for the Route Field Home (Phase D1B).
 * Deterministic — identical output across runs (stable screenshots, no hydration drift).
 * No real data. No user balance / deposits / "remaining $X" / Pocket integration.
 * UI reads only through getHomeState(); it must not import fixtures ad hoc.
 */

import type { HomeState, HomeScenario, RouteNodeModel } from "@/domain/home";
import { rankLabel } from "@/domain/home";

const MODULE_4 = { ordinal: 4, name: "Чтение графика", completed: 2, total: 5 };

// Route fragment around the current position (levels 15–21), canonical names.
const ROUTE_ACTIVE: RouteNodeModel[] = [
  { index: 15, state: "checkpoint", label: "Контрольная точка · Уровень 15" },
  { index: 16, state: "completed", label: "Свечи" },
  { index: 17, state: "completed", label: "Тренд и диапазон" },
  { index: 18, state: "current", label: "Поддержка и сопротивление" },
  { index: 19, state: "upcoming", label: "Разметка графика" },
  { index: 20, state: "checkpoint", label: "Контрольная точка · Уровень 20" },
  { index: 21, state: "locked", label: "Stochastic" },
];

// In the checkpoint scenario levels 16–20 learning requirements are done; L20 is the current step.
const ROUTE_CHECKPOINT: RouteNodeModel[] = ROUTE_ACTIVE.map((n) => {
  if (n.index < 20) return { ...n, state: "completed" };
  if (n.index === 20) return { ...n, state: "checkpoint" };
  return { ...n, state: "locked" };
});

const BASE = {
  user: { name: "Артём", greeting: "Привет, Артём" },
  instrumentation: {
    rankLabel: rankLabel("observer", 3), // Наблюдатель III
    xp: 2480,
    xpLabel: "2 480 XP",
    streakCurrent: 6,
  },
  lesson: {
    levelIndex: 18,
    title: "Поддержка и сопротивление",
    module: MODULE_4,
  },
  upcomingLevelIndex: 19,
  checkpoint: {
    levelIndex: 20,
    requirementUsd: 200,
    nextRankLabel: rankLabel("observer", 4), // Наблюдатель IV
    unlockToolName: "Chart Markup Tool",
  },
  toolsAvailable: ["Trading Journal", "Risk Calculator"] as string[],
};

const ACTIVE: HomeState = {
  scenario: "active",
  ...BASE,
  route: ROUTE_ACTIVE,
  mentor: {
    text: "Уровень — это зона реакции рынка, а не точная линия. Разметь три графика и объясни зоны — так проверишь понимание.",
  },
  primaryAction: { label: "Продолжить урок", kind: "continue-lesson" },
};

const CHECKPOINT: HomeState = {
  scenario: "checkpoint",
  ...BASE,
  route: ROUTE_CHECKPOINT,
  mentor: {
    text: "Контрольная точка подтверждает готовность идти дальше. Проверка выполнится сама — спешить не нужно.",
  },
  primaryAction: { label: "Проверить выполнение", kind: "verify-checkpoint" },
};

const STATES: Record<HomeScenario, HomeState> = { active: ACTIVE, checkpoint: CHECKPOINT };

/** The only entry point the UI uses to read Home state. */
export function getHomeState(scenario: HomeScenario): HomeState {
  return STATES[scenario];
}
