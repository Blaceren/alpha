/**
 * Shared SYNTHETIC dashboard state (Phase D1A).
 * All three art directions render exactly this data so they can be compared
 * fairly. Names are canonical from les-prog.txt (Module 4 "Чтение графика",
 * levels 16–20). No real user data. No balance / deposits / "remaining $X".
 */

import type { DashboardState } from "@/domain/progression";
import { rankLabel } from "@/domain/progression";
import type { DashboardProvider } from "@/data/contracts/dashboard-contract";

export const SYNTHETIC_DASHBOARD: DashboardState = {
  user: { greeting: "Привет, Артём" },

  // Rank earned at the L15 checkpoint ($150) — Наблюдатель III.
  rank: {
    code: "rank.observer_3",
    family: "observer",
    tier: 3,
    label: rankLabel("observer", 3),
  },

  // Learner is on level 18 — "Поддержка и сопротивление".
  level: {
    index: 18,
    lessonName: "Поддержка и сопротивление",
  },

  module: {
    name: "Чтение графика",
    ordinal: 4,
    completedLevels: 2,
    totalLevels: 5,
  },

  xp: { current: 2480, label: "2 480 XP" },

  streak: { current: 6, best: 11, active: true },

  // Checkpoint is NOT yet the primary action — continuing the lesson is.
  primaryAction: {
    label: "Продолжить урок",
    context: "Поддержка и сопротивление · Модуль 4 «Чтение графика»",
    kind: "continue-lesson",
  },

  // Horizontal path fragment around the current level (15–21).
  path: [
    {
      code: "level.015",
      index: 15,
      state: "checkpoint",
      activity: "checkpoint",
      label: "Контрольная точка",
      reward: "Risk Calculator",
    },
    { code: "level.016", index: 16, state: "completed", activity: "lesson", label: "Свечи" },
    {
      code: "level.017",
      index: 17,
      state: "completed",
      activity: "lesson",
      label: "Тренд и диапазон",
    },
    {
      code: "level.018",
      index: 18,
      state: "active",
      activity: "lesson",
      label: "Поддержка и сопротивление",
    },
    {
      code: "level.019",
      index: 19,
      state: "locked",
      activity: "practical",
      label: "Разметка графика",
    },
    {
      code: "level.020",
      index: 20,
      state: "checkpoint",
      activity: "checkpoint",
      label: "Контрольная точка",
      reward: "Chart Markup Tool",
    },
    { code: "level.021", index: 21, state: "locked", activity: "lesson", label: "Stochastic" },
  ],

  // Next checkpoint: L20, target from $200, unlocks Наблюдатель IV.
  nextCheckpoint: {
    levelIndex: 20,
    targetUsd: 200,
    rankLabel: rankLabel("observer", 4),
  },

  // Nearest reward is the Chart Markup Tool (unlocks at L20).
  nearestReward: {
    code: "tool.chart_markup",
    name: "Chart Markup Tool",
    description: "Разметка графика по скриншоту",
    unlockLevel: 20,
    state: "nearest-reward",
  },

  tools: [
    {
      code: "tool.trading_journal",
      name: "Trading Journal",
      description: "Торговый дневник",
      unlockLevel: 10,
      state: "available",
    },
    {
      code: "tool.risk_calculator",
      name: "Risk Calculator",
      description: "Калькулятор риска",
      unlockLevel: 15,
      state: "available",
    },
    {
      code: "tool.chart_markup",
      name: "Chart Markup Tool",
      description: "Разметка графика",
      unlockLevel: 20,
      state: "nearest-reward",
    },
    {
      code: "tool.indicator_checklist",
      name: "Indicator Checklist",
      description: "Чек-лист индикаторов",
      unlockLevel: 25,
      state: "locked",
    },
    {
      code: "tool.news_calendar",
      name: "News Calendar",
      description: "Календарь новостей",
      unlockLevel: 30,
      state: "locked",
    },
  ],

  alex: {
    text: "Уровни — это зоны реакции рынка, а не точные точки. Досмотри урок и переходи к разметке графиков — по одному шагу.",
  },
};

/** Synthetic provider satisfying the future backend contract. */
export const syntheticDashboardProvider: DashboardProvider = {
  getDashboardState() {
    return SYNTHETIC_DASHBOARD;
  },
};
