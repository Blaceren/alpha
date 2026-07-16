/**
 * Typed curriculum fixture (Phase D2A) — the single source the UI reads.
 * Canonical sources: les-prog.txt + docs/CURRICULUM_AND_UNLOCKS.md. Raw txt is
 * NEVER imported into React; this file is the typed, tested translation of it.
 *
 * Contains structure only (20 modules, 100 levels, 20 checkpoints, unlocks).
 * No user progress, no XP logic, no balances. Level state is derived by the
 * scenario adapter (path-state.ts).
 */

import type {
  Curriculum,
  CurriculumLevel,
  CurriculumLevelKind,
  CurriculumModule,
  CheckpointDefinition,
  ReportRequirement,
  MentorReviewRequirement,
  ToolUnlock,
  CommunityUnlock,
  RankTransition,
} from "@/domain/curriculum";
import { rankLabel, type RankFamily } from "@/domain/progression";

/* ------------------------------------------------------------------ *
 * Modules: [index, title, description, startLevel, endLevel]
 * ------------------------------------------------------------------ */
const MODULE_ROWS: Array<[number, string, string, number, number]> = [
  [1, "Первое знакомство", "Регистрация Pocket, устройство академии и первые demo-сделки.", 1, 4],
  [2, "Как работает сделка", "Жизненный цикл сделки, экспирация, активы и решение о входе.", 5, 10],
  [3, "Управление риском", "Торговый капитал, размер позиции, лимиты потерь и личный Risk Plan.", 11, 15],
  [4, "Чтение графика", "Свечи, тренд и диапазон, уровни поддержки и сопротивления, разметка.", 16, 20],
  [5, "Индикаторы", "Stochastic, Bollinger Bands, объединение сигналов и ложные сигналы.", 21, 25],
  [6, "Новости", "Экономический календарь, реакция цены и план работы вокруг новостей.", 26, 30],
  [7, "Психология новичка", "Страх потери, revenge trading, FOMO и Pause Protocol.", 31, 35],
  [8, "Торговый дневник", "Записи до и после сделки, недельный обзор.", 36, 40],
  [9, "Первая стратегия", "Setup, правила входа, таймфрейм и карточка стратегии.", 41, 45],
  [10, "Капитал и просадка", "Просадка, восстановление и Capital Protection Plan.", 46, 50],
  [11, "Рыночные режимы", "Таймфреймы, тренд и боковик, волатильность, выбор setup под режим.", 51, 55],
  [12, "Исполнение", "Подготовка к сессии, качество входа, overtrading и аудит сессии.", 56, 60],
  [13, "Статистика", "Win rate, математическое ожидание, размер выборки и анализ.", 61, 65],
  [14, "Активы", "Специализация, корреляция, ограничение внимания и watchlist.", 66, 70],
  [15, "Продвинутая психология", "Tilt, усталость, уверенность против данных и аудит.", 71, 75],
  [16, "Привычка", "Устойчивый режим, ритуалы и план дисциплины на 30 дней.", 76, 80],
  [17, "Кейсы", "Полный торговый кейс, неполная информация и защита решения.", 81, 85],
  [18, "Аналитика результатов", "Equity curve, серии и variance, устойчивость стратегии.", 86, 90],
  [19, "Личный Playbook", "Структура playbook, правила входа и отказа, личные red flags.", 91, 95],
  [20, "Самостоятельная система", "Teach-back, план на 90 дней и финальный экзамен.", 96, 100],
];

/* ------------------------------------------------------------------ *
 * Levels: [number, title, kind, artifact?, mentorReview?]
 * Titles are canonical (les-prog.txt / CURRICULUM_AND_UNLOCKS.md).
 * ------------------------------------------------------------------ */
type LevelRow = [number, string, CurriculumLevelKind, string?, true?];

const LEVEL_ROWS: LevelRow[] = [
  [1, "Регистрация Pocket", "task", "Регистрация и подтверждение аккаунта Pocket"],
  [2, "Как устроен Alfa Trade Academy", "video-test"],
  [3, "Первые пять demo-сделок", "report", "Отчёт по 5 demo-сделкам"],
  [4, "Контрольная точка $50", "checkpoint"],
  [5, "Жизненный цикл сделки", "video-test"],
  [6, "Экспирация и payout", "video-test"],
  [7, "Активы, время и OTC", "video-test"],
  [8, "Войти или отказаться", "video-test", "Сценарии «войти / ждать / отказаться»"],
  [9, "Checklist перед входом", "practical", "Собственный checklist"],
  [10, "Контрольная точка $100", "checkpoint"],
  [11, "Торговый капитал", "video-test"],
  [12, "Размер позиции и серии убытков", "video-test"],
  [13, "Дневной лимит потерь", "video-test"],
  [14, "Личный Risk Plan", "practical", "Risk Plan", true],
  [15, "Контрольная точка $150", "checkpoint"],
  [16, "Свечи", "video-test"],
  [17, "Тренд и диапазон", "video-test"],
  [18, "Поддержка и сопротивление", "video-test"],
  [19, "Разметка графика", "practical", "Разметка 3 графиков"],
  [20, "Контрольная точка $200", "checkpoint"],
  [21, "Stochastic", "video-test"],
  [22, "Bollinger Bands", "video-test"],
  [23, "Объединение сигналов", "video-test"],
  [24, "Ложные сигналы", "practical", "Разбор сценариев и red flags"],
  [25, "Контрольная точка $300", "checkpoint"],
  [26, "Экономический календарь", "video-test"],
  [27, "Реакция цены на новости", "video-test"],
  [28, "Когда не стоит торговать", "video-test"],
  [29, "План работы вокруг новостей", "practical", "План вокруг новостей", true],
  [30, "Контрольная точка $400", "checkpoint"],
  [31, "Страх потери", "video-test"],
  [32, "Revenge trading", "video-test"],
  [33, "FOMO", "video-test"],
  [34, "Pause Protocol", "practical", "Триггеры, длительность, возврат"],
  [35, "Контрольная точка $500", "checkpoint"],
  [36, "Почему память обманывает", "video-test"],
  [37, "Запись до сделки", "video-test"],
  [38, "Запись после сделки", "video-test"],
  [39, "Недельный обзор", "practical", "Weekly review"],
  [40, "Контрольная точка $750", "checkpoint"],
  [41, "Что такое setup", "video-test"],
  [42, "Чёткие правила входа", "video-test"],
  [43, "Таймфрейм и экспирация", "video-test"],
  [44, "Карточка стратегии", "practical", "Strategy Card", true],
  [45, "Контрольная точка $1,000", "checkpoint"],
  [46, "Просадка", "video-test"],
  [47, "Восстановление после просадки", "video-test"],
  [48, "Распределение капитала", "video-test"],
  [49, "Capital Protection Plan", "practical", "Уровни предупреждения, паузы и восстановления"],
  [50, "Контрольная точка $1,500", "checkpoint"],
  [51, "Несколько таймфреймов", "video-test"],
  [52, "Тренд и боковик", "video-test"],
  [53, "Волатильность", "video-test"],
  [54, "Выбор setup под режим", "practical", "Сценарии выбора и отказа"],
  [55, "Контрольная точка $2,000", "checkpoint"],
  [56, "Подготовка к сессии", "video-test"],
  [57, "Качество входа", "video-test"],
  [58, "Overtrading", "video-test"],
  [59, "Аудит сессии", "practical", "Сравнение плана и действий", true],
  [60, "Контрольная точка $2,500", "checkpoint"],
  [61, "Win rate", "video-test"],
  [62, "Математическое ожидание", "video-test"],
  [63, "Размер выборки", "video-test"],
  [64, "Анализ статистики", "practical", "Разбивка по setup, времени, активу и режиму"],
  [65, "Контрольная точка $3,000", "checkpoint"],
  [66, "Специализация", "video-test"],
  [67, "Корреляция", "video-test"],
  [68, "Ограничение внимания", "video-test"],
  [69, "Недельный Watchlist", "practical", "Watchlist с причинами"],
  [70, "Контрольная точка $4,000", "checkpoint"],
  [71, "Tilt", "video-test"],
  [72, "Усталость", "video-test"],
  [73, "Уверенность против данных", "video-test"],
  [74, "Психологический аудит", "practical", "Триггеры и правила", true],
  [75, "Контрольная точка $5,000", "checkpoint"],
  [76, "Устойчивый режим", "video-test"],
  [77, "Дневной и недельный ритуал", "video-test"],
  [78, "Возвращение после перерыва", "video-test"],
  [79, "План дисциплины на 30 дней", "practical", "Персональный график"],
  [80, "Контрольная точка $6,000", "checkpoint"],
  [81, "Полный торговый кейс", "video-test"],
  [82, "Неполная информация", "video-test"],
  [83, "Библиотека ошибок", "practical", "5 карточек ошибок"],
  [84, "Защита решения", "practical", "Защита кейса", true],
  [85, "Контрольная точка $7,000", "checkpoint"],
  [86, "Equity curve", "video-test"],
  [87, "Серии и variance", "video-test"],
  [88, "Устойчивость стратегии", "video-test"],
  [89, "План улучшения", "practical", "Одна проблема / одно изменение"],
  [90, "Контрольная точка $8,000", "checkpoint"],
  [91, "Структура Playbook", "video-test"],
  [92, "Правила входа и отказа", "video-test"],
  [93, "Личные Red Flags", "video-test"],
  [94, "Mentor Review Playbook", "practical", "Playbook на проверку", true],
  [95, "Контрольная точка $9,000", "checkpoint"],
  [96, "Teach-back", "video-test"],
  [97, "План на 90 дней", "video-test"],
  [98, "План действий при просадке", "video-test"],
  [99, "Финальный экзамен", "practical", "Финальный экзамен"],
  [100, "Контрольная точка $10,000", "checkpoint"],
];

/* ------------------------------------------------------------------ *
 * Checkpoints: level → [thresholdUsd, family, tier, tool?, channel?]
 * ------------------------------------------------------------------ */
type CheckpointRow = [
  number,
  RankFamily,
  1 | 2 | 3 | 4,
  [string, string]?, // [tool code suffix, tool name]
  [string, string]?, // [channel code suffix, channel RU name]
];

const CHECKPOINT_ROWS: Record<number, CheckpointRow> = {
  4: [50, "observer", 1, undefined, ["start_questions", "Старт и вопросы"]],
  10: [100, "observer", 2, ["trading_journal", "Trading Journal"]],
  15: [150, "observer", 3, ["risk_calculator", "Risk Calculator"]],
  20: [200, "observer", 4, ["chart_markup", "Chart Markup Tool"], ["chart_review", "Разбор графиков"]],
  25: [300, "analyst", 1, ["indicator_checklist", "Indicator Checklist"]],
  30: [400, "analyst", 2, ["news_calendar", "News Calendar"]],
  35: [500, "analyst", 3, ["pause_mode", "Pause Mode"], ["discipline_journal", "Дисциплина и дневник"]],
  40: [750, "analyst", 4, ["weekly_review", "Weekly Review"]],
  45: [1000, "tactician", 1, ["strategy_builder", "Strategy Builder"], ["strategies", "Стратегии"]],
  50: [1500, "tactician", 2, ["capital_plan", "Capital Plan"]],
  55: [2000, "tactician", 3, ["market_regime_board", "Market Regime Board"]],
  60: [2500, "tactician", 4, ["session_planner", "Session Planner"]],
  65: [3000, "strategist", 1, ["strategy_statistics", "Strategy Statistics"]],
  70: [4000, "strategist", 2, ["watchlist", "Watchlist"]],
  75: [5000, "strategist", 3, ["psychology_checkin", "Psychology Check-in"]],
  80: [6000, "strategist", 4, ["habit_calendar", "Habit Calendar"]],
  85: [7000, "architect", 1, ["mentor_case_room", "Mentor Case Room"], ["advanced_circle", "Продвинутый круг"]],
  90: [8000, "architect", 2, ["performance_dashboard", "Performance Dashboard"]],
  95: [9000, "architect", 3, ["personal_playbook", "Personal Playbook"]],
  100: [10000, "architect", 4, ["pro_workspace", "Pro Workspace"]],
};

/* ------------------------------------------------------------------ *
 * Assembly (runs once at module load; fully deterministic)
 * ------------------------------------------------------------------ */
function pad3(n: number): string {
  return n.toString().padStart(3, "0");
}

function buildCheckpoint(level: number): CheckpointDefinition {
  const row = CHECKPOINT_ROWS[level];
  if (!row) throw new Error(`No checkpoint row for level ${level}`);
  const [thresholdUsd, family, tier, tool, channel] = row;
  const rank: RankTransition = {
    code: `rank.${family}_${tier}`,
    family,
    tier,
    label: rankLabel(family, tier),
  };
  const toolUnlock: ToolUnlock | undefined = tool
    ? { code: `tool.${tool[0]}`, name: tool[1], unlockLevel: level }
    : undefined;
  const communityUnlock: CommunityUnlock | undefined = channel
    ? { code: `channel.${channel[0]}`, name: channel[1], unlockLevel: level }
    : undefined;
  return {
    code: `checkpoint.${pad3(level)}`,
    level,
    thresholdUsd,
    rank,
    toolUnlock,
    communityUnlock,
  };
}

function buildCurriculum(): Curriculum {
  const modules: CurriculumModule[] = MODULE_ROWS.map(
    ([index, title, description, startLevel, endLevel]) => {
      const moduleCode = `module.${index.toString().padStart(2, "0")}`;
      const levels: CurriculumLevel[] = LEVEL_ROWS.filter(
        ([n]) => n >= startLevel && n <= endLevel,
      ).map(([number, levelTitle, kind, artifact, mentor]) => ({
        code: `level.${pad3(number)}`,
        number,
        title: levelTitle,
        moduleCode,
        kind,
        artifact,
        mentorReview: mentor === true,
        checkpoint: kind === "checkpoint" ? buildCheckpoint(number) : undefined,
      }));
      const checkpoint = levels.at(-1)?.checkpoint;
      if (!checkpoint) throw new Error(`Module ${moduleCode} must end with a checkpoint`);
      return { code: moduleCode, index, title, description, startLevel, endLevel, levels, checkpoint };
    },
  );
  return { modules, levels: modules.flatMap((m) => m.levels) };
}

export const CURRICULUM: Curriculum = buildCurriculum();

/* ------------------------------------------------------------------ *
 * Lookup helpers (pure, deterministic)
 * ------------------------------------------------------------------ */

export function getLevel(number: number): CurriculumLevel {
  const level = CURRICULUM.levels[number - 1];
  if (!level || level.number !== number) throw new Error(`Unknown level ${number}`);
  return level;
}

export function getModuleByIndex(index: number): CurriculumModule {
  const mod = CURRICULUM.modules[index - 1];
  if (!mod || mod.index !== index) throw new Error(`Unknown module ${index}`);
  return mod;
}

export function getModuleForLevel(levelNumber: number): CurriculumModule {
  const mod = CURRICULUM.modules.find(
    (m) => levelNumber >= m.startLevel && levelNumber <= m.endLevel,
  );
  if (!mod) throw new Error(`No module for level ${levelNumber}`);
  return mod;
}

/** The nearest checkpoint at or after the given level. */
export function getNextCheckpoint(levelNumber: number): CheckpointDefinition {
  return getModuleForLevel(levelNumber).checkpoint;
}

/** Derived: all structured report / practical artifacts. */
export const REPORT_REQUIREMENTS: ReportRequirement[] = CURRICULUM.levels
  .filter((l) => l.artifact !== undefined)
  .map((l) => ({ levelNumber: l.number, artifact: l.artifact as string }));

/** Derived: mandatory mentor review levels. */
export const MENTOR_REVIEW_REQUIREMENTS: MentorReviewRequirement[] = CURRICULUM.levels
  .filter((l) => l.mentorReview)
  .map((l) => ({ levelNumber: l.number }));

/** Derived: all curriculum tool unlocks (19; the Secret tool is referral-gated, not here). */
export const TOOL_UNLOCKS: ToolUnlock[] = CURRICULUM.modules
  .map((m) => m.checkpoint.toolUnlock)
  .filter((t): t is ToolUnlock => t !== undefined);

/** Derived: community unlocks (5). */
export const COMMUNITY_UNLOCKS: CommunityUnlock[] = CURRICULUM.modules
  .map((m) => m.checkpoint.communityUnlock)
  .filter((c): c is CommunityUnlock => c !== undefined);
