/**
 * Tools catalog (Phase D4-B) — the ONE place that turns the canonical curriculum
 * tool unlocks into a bounded tool domain.
 *
 * The unlock LEVEL is never re-stated here: it is read verbatim from
 * `TOOL_UNLOCKS` (derived from `CHECKPOINT_ROWS` in the curriculum fixture). This
 * file adds only the two things the curriculum does not carry — a short RU
 * description and whether the tool's SURFACE is actually implemented yet
 * (`implementationStatus`). Everything financial stays out (DD-303): a tool is a
 * personal discipline object, never a broker feature.
 *
 * `code` doubles as the route-safe `[toolCode]` segment (ROUTE_MAP §… — the same
 * `tool.trading_journal` shape the curriculum assigns, exactly like `level.018`
 * addresses a lesson). Dots are valid in a path segment and already used by the
 * lesson route.
 */

import { TOOL_UNLOCKS } from "@/data/curriculum/fixture";
import type { ToolUnlock } from "@/domain/curriculum";

/** Whether the tool's working SURFACE exists in this build. */
export type ToolImplementationStatus = "available" | "coming-soon";

export interface ToolDefinition {
  /** Canonical tool id (the curriculum code, e.g. "tool.trading_journal"). */
  id: string;
  /** Route-safe code — identical to the id; used as the `[toolCode]` segment. */
  code: string;
  /** Tool name (English kept as domain language, matching the curriculum). */
  title: string;
  /** Short RU description shown next to the name. Never a financial claim. */
  description: string;
  /** Unlock level — READ from the curriculum unlock, never re-declared. */
  unlockLevel: number;
  implementationStatus: ToolImplementationStatus;
  /** Per-tool hub CTA copy — never one hardcoded label for all tools (§11). */
  ctaLabel: string;
}

/**
 * Per-tool metadata keyed by canonical code. Adds ONLY description +
 * implementation status + hub CTA copy; the unlock level is joined from
 * `TOOL_UNLOCKS`. A tool absent from this map falls back to a neutral
 * description and `coming-soon`, so the catalog can never crash on a curriculum
 * tool we have not annotated yet.
 */
interface ToolMeta {
  description: string;
  implementationStatus: ToolImplementationStatus;
  /**
   * The CTA shown for THIS tool when it is available. Tool-specific by design;
   * only meaningful for `available` tools (a coming-soon tool never shows one).
   * Omitted → the neutral fallback, so we never hardcode one label everywhere.
   */
  ctaLabel?: string;
}

/** Neutral CTA used only if an available tool forgot to declare its own. */
const FALLBACK_CTA = "Открыть инструмент";

const TOOL_META: Record<string, ToolMeta> = {
  "tool.trading_journal": {
    description: "Ручной разбор отдельных сделок: план, исполнение и вывод.",
    implementationStatus: "available",
    ctaLabel: "Открыть журнал",
  },
  "tool.risk_calculator": {
    description: "Ручной расчёт размера позиции и риска по цене входа и стопу.",
    implementationStatus: "available",
    ctaLabel: "Открыть калькулятор",
  },
  "tool.chart_markup": {
    description: "Разметка графиков: уровни, тренд и зоны решения.",
    implementationStatus: "coming-soon",
  },
  "tool.indicator_checklist": {
    description: "Проверка сигналов по индикаторам перед входом.",
    implementationStatus: "coming-soon",
  },
  "tool.news_calendar": {
    description: "Экономический календарь и план работы вокруг новостей.",
    implementationStatus: "coming-soon",
  },
  "tool.pause_mode": {
    description: "Протокол паузы: остановиться до потери контроля.",
    implementationStatus: "coming-soon",
  },
  "tool.weekly_review": {
    description: "Недельный обзор решений и дисциплины.",
    implementationStatus: "coming-soon",
  },
  "tool.strategy_builder": {
    description: "Сборка правил входа и отказа в личную стратегию.",
    implementationStatus: "coming-soon",
  },
  "tool.capital_plan": {
    description: "План защиты капитала: пороги, паузы и восстановление.",
    implementationStatus: "coming-soon",
  },
  "tool.market_regime_board": {
    description: "Определение режима рынка и выбор setup под него.",
    implementationStatus: "coming-soon",
  },
  "tool.session_planner": {
    description: "Подготовка к торговой сессии и её аудит.",
    implementationStatus: "coming-soon",
  },
  "tool.strategy_statistics": {
    description: "Разбор статистики стратегии по setup, времени и активу.",
    implementationStatus: "coming-soon",
  },
  "tool.watchlist": {
    description: "Недельный watchlist активов с причинами выбора.",
    implementationStatus: "coming-soon",
  },
  "tool.psychology_checkin": {
    description: "Психологический чек-ин: триггеры, усталость и правила.",
    implementationStatus: "coming-soon",
  },
  "tool.habit_calendar": {
    description: "Календарь привычки и ритуалов дисциплины.",
    implementationStatus: "coming-soon",
  },
  "tool.mentor_case_room": {
    description: "Разбор полного торгового кейса и защита решения.",
    implementationStatus: "coming-soon",
  },
  "tool.performance_dashboard": {
    description: "Разбор устойчивости стратегии по сериям решений.",
    implementationStatus: "coming-soon",
  },
  "tool.personal_playbook": {
    description: "Личный playbook: правила входа, отказа и red flags.",
    implementationStatus: "coming-soon",
  },
  "tool.pro_workspace": {
    description: "Итоговое рабочее пространство самостоятельной системы.",
    implementationStatus: "coming-soon",
  },
};

const FALLBACK_META: ToolMeta = {
  description: "Личный рабочий инструмент дисциплины.",
  implementationStatus: "coming-soon",
};

function toDefinition(unlock: ToolUnlock): ToolDefinition {
  const meta = TOOL_META[unlock.code] ?? FALLBACK_META;
  return {
    id: unlock.code,
    code: unlock.code,
    title: unlock.name,
    description: meta.description,
    unlockLevel: unlock.unlockLevel,
    implementationStatus: meta.implementationStatus,
    ctaLabel: meta.ctaLabel ?? FALLBACK_CTA,
  };
}

/**
 * Every curriculum tool, in unlock order (L10 → L100). Built once from the
 * canonical unlocks — the sequence and the levels are the curriculum's, not ours.
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = TOOL_UNLOCKS.map(toDefinition).sort(
  (a, b) => a.unlockLevel - b.unlockLevel || a.code.localeCompare(b.code),
);

/** Look up one tool definition by its canonical code. Null when unknown. */
export function getToolDefinition(code: string): ToolDefinition | null {
  return TOOL_DEFINITIONS.find((tool) => tool.code === code) ?? null;
}

/** The featured first tool of the whole slice. */
export const TRADING_JOURNAL_CODE = "tool.trading_journal";

/** The Risk Calculator surface code (Phase D4-C). */
export const RISK_CALCULATOR_CODE = "tool.risk_calculator";
