/**
 * Lessons library presentation projector (Phase D2C-B).
 *
 * WHAT THIS IS: the single place that turns the EXISTING sources of truth into a
 * ready-to-render model for /lessons. React components receive this model and
 * render it — they never re-derive a progression rule (DD-256 extended to the
 * library, DD-262).
 *
 * WHAT IT NEVER DOES: it does not copy the curriculum into a second array, does
 * not invent a second set of module/level titles, checkpoint thresholds, rewards,
 * lesson kinds or progression statuses, and does not store progress. Every value
 * below is read from:
 *
 *   - `@/data/curriculum/fixture`            — structure (20 modules / 100 levels)
 *   - `@/features/path/model/path-state`     — the shared sequential marker
 *   - `@/features/lesson/model/lesson-availability` — sequence + session resolver
 *   - `@/features/lesson/data/lesson-fixtures`      — lesson bodies (duration)
 *
 * Financial privacy (CLAUDE.md, DD-259): a checkpoint carries its TARGET and what
 * it opens — never the user's balance, never "осталось $X", never a percentage of
 * a financial goal, never a Pocket link.
 */

import {
  CURRICULUM,
  getModuleByIndex,
  getModuleForLevel,
} from "@/data/curriculum/fixture";
import { formatThresholdUsd } from "@/domain/curriculum";
import type { CurriculumLevel, CurriculumLevelKind } from "@/domain/curriculum";
import {
  moduleAggregateState,
  moduleCompletedCount,
  type ModuleAggregateState,
  type PathProgress,
} from "@/features/path/model/path-state";
import { resolveRouteAvailability } from "@/features/lesson/model/lesson-availability";
import {
  isLevelCompletedInSession,
  type LessonSessionProgress,
} from "@/features/lesson/model/lesson-session-progress";
import { getLessonEntry } from "@/features/lesson/data/lesson-fixtures";
import { formatDuration, levelCodeFor } from "@/features/lesson/model/lesson";
import { isReportLevelNumber } from "@/features/report-level/model/report";
import {
  emptyReportWorkspaceV3,
  getStoredDraftV3,
  type ReportWorkspaceStateV3,
} from "@/features/report-level/model/report-workspace-v3";
import {
  deriveReportLifecycle,
  reportStatusLabel,
  type ReportLifecycle,
} from "@/features/report-level/model/report-experience";

/* ------------------------------------------------------------------ *
 * Module code — the canonical identifier, reused (never a second id)
 * ------------------------------------------------------------------ */

/** The user-facing query parameter carrying module selection. NOT a dev scenario. */
export const MODULE_QUERY_PARAM = "module";

/** 4 → "module.04" — the same code shape the curriculum fixture already assigns. */
export function moduleCodeFor(index: number): string {
  return `module.${String(index).padStart(2, "0")}`;
}

/**
 * Parse a module code back to its index. Returns null for anything that is not a
 * canonical `module.NN` in 1–20, so the route answers with a safe fallback rather
 * than throwing.
 */
export function parseModuleCode(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const match = /^module\.(\d{2})$/.exec(raw);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isInteger(value) || value < 1 || value > CURRICULUM.modules.length) return null;
  return value;
}

/* ------------------------------------------------------------------ *
 * Lesson kind labels — ONE owner
 * ------------------------------------------------------------------ */

/**
 * RU label for a level's activity kind. This map is the single owner of the
 * wording: before D2C the same strings were inlined ad hoc in path/lesson
 * components, which is exactly how a third divergent copy appears.
 */
const KIND_LABEL: Record<CurriculumLevelKind, string> = {
  task: "Задание",
  "video-test": "Видео-урок и тест",
  report: "Отчёт",
  practical: "Практическое задание",
  checkpoint: "Контрольная точка",
};

export function kindLabel(kind: CurriculumLevelKind): string {
  return KIND_LABEL[kind];
}

/* ------------------------------------------------------------------ *
 * Effective progress: sequence + this session
 * ------------------------------------------------------------------ */

/**
 * The sequential marker as it stands once THIS session's completions are layered
 * on top.
 *
 * The session may only ever ADVANCE the marker: it walks forward while each
 * successive level is recorded as completed here. It can never move the marker
 * back, and it can never skip — a session record only exists because the user
 * finished that very level (DD-256).
 */
export function effectiveProgress(
  marker: PathProgress,
  session: LessonSessionProgress,
): PathProgress {
  let current = marker.currentLevel;
  const last = CURRICULUM.levels.length;
  while (current < last && isLevelCompletedInSession(session, current)) {
    current += 1;
  }
  return current === marker.currentLevel ? marker : { ...marker, currentLevel: current };
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

export interface ModuleSelection {
  index: number;
  /** True when the requested module code was absent/unknown and we fell back. */
  isFallback: boolean;
}

/**
 * Which module the page shows. The default is the user's CURRENT module, taken
 * from the shared progress marker — never a hardcoded 04 in a component.
 * Anything unparseable falls back to that same current module, safely.
 */
export function resolveSelectedModule(
  raw: unknown,
  progress: PathProgress,
): ModuleSelection {
  const currentIndex = getModuleForLevel(progress.currentLevel).index;
  if (raw === undefined || raw === null || raw === "") {
    return { index: currentIndex, isFallback: false };
  }
  const parsed = parseModuleCode(raw);
  if (parsed === null) return { index: currentIndex, isFallback: true };
  return { index: parsed, isFallback: false };
}

/* ------------------------------------------------------------------ *
 * Model shape
 * ------------------------------------------------------------------ */

/** Row state of a level inside the library. Derived, never stored. */
export type LibraryLevelState =
  | "completed"
  | "current"
  | "available"
  | "locked"
  | "checkpoint";

export interface LibraryCheckpointInfo {
  /** Target only, e.g. "Баланс Pocket от $200". Never the user's balance. */
  requirement: string;
  /** What passing it opens: tool / rank / channel — in that canonical order. */
  rewards: string[];
}

export interface LibraryLevelRow {
  code: string;
  number: number;
  title: string;
  kindLabel: string;
  /** Only when a real duration exists in the lesson fixture; otherwise null. */
  durationLabel: string | null;
  state: LibraryLevelState;
  /** Text status — state is never conveyed by colour alone. */
  statusLabel: string;
  /** Canonical lesson href, or null when the level cannot be opened. */
  href: string | null;
  /** Label of the row's action, or null when there is no action. */
  actionLabel: string | null;
  /** Required artifact of a report/practical level, when the curriculum says so. */
  artifact: string | null;
  mentorReview: boolean;
  checkpoint: LibraryCheckpointInfo | null;
}

export interface LibraryModuleRow {
  code: string;
  index: number;
  title: string;
  state: ModuleAggregateState;
  statusLabel: string;
  completedCount: number;
  totalCount: number;
  href: string;
  isSelected: boolean;
  isCurrent: boolean;
}

export interface LibrarySelectedModule {
  code: string;
  index: number;
  title: string;
  description: string;
  startLevel: number;
  endLevel: number;
  completedCount: number;
  totalCount: number;
  levels: LibraryLevelRow[];
  /** Present unless the module has no reachable action at all. */
  hasAnyAction: boolean;
}

export interface LibraryContinueStep {
  levelNumber: number;
  title: string;
  moduleIndex: number;
  moduleTitle: string;
  kindLabel: string;
  durationLabel: string | null;
  href: string;
  /** RU eyebrow, e.g. "Продолжить обучение". */
  eyebrow: string;
  /** RU CTA wording. Owned by the model — a component never re-decides it. */
  actionLabel: string;
  /** Report lifecycle label when the step is a report in progress; else null. */
  reportStatusLabel: string | null;
}

export interface LessonsLibraryModel {
  /** The one dominant action, or null when nothing is open (e.g. all completed). */
  continueStep: LibraryContinueStep | null;
  /** Honest explanation when there is no continue step. */
  continueNote: string | null;
  modules: LibraryModuleRow[];
  selected: LibrarySelectedModule;
  currentModuleIndex: number;
  /** True when the requested ?module= code was unknown and we fell back. */
  isModuleFallback: boolean;
  totalModules: number;
  totalLevels: number;
}

/* ------------------------------------------------------------------ *
 * Projection
 * ------------------------------------------------------------------ */

/** Href of a module inside the library. Uses the canonical module code. */
export function moduleHref(index: number): string {
  return `/lessons?${MODULE_QUERY_PARAM}=${moduleCodeFor(index)}`;
}

/** Canonical lesson href. Never carries a scenario (DD-255). */
export function lessonHref(levelNumber: number): string {
  return `/lessons/${levelCodeFor(levelNumber)}`;
}

/** The real duration of a level, when a lesson fixture actually defines one. */
function durationLabelFor(levelNumber: number): string | null {
  const entry = getLessonEntry(levelNumber);
  if (entry?.kind !== "full") return null;
  return formatDuration(entry.lesson.media.durationSeconds);
}

const MODULE_STATE_LABEL: Record<ModuleAggregateState, string> = {
  completed: "пройден",
  current: "текущий",
  upcoming: "далее",
  locked: "впереди",
};

/**
 * Exported so the Backend-driven checkpoint screen reads the SAME canonical
 * target and rewards the library shows, instead of a second copy of the
 * curriculum. Target only — never a balance, never a remainder (DD-259).
 */
export function buildCheckpointInfo(levelNumber: number): LibraryCheckpointInfo | null {
  const mod = getModuleForLevel(levelNumber);
  const cp = mod.checkpoint;
  if (cp.level !== levelNumber) return null;

  // Target only. No balance, no remainder, no percentage, no Pocket link.
  const rewards: string[] = [];
  if (cp.toolUnlock) rewards.push(cp.toolUnlock.name);
  rewards.push(`ранг ${cp.rank.label}`);
  if (cp.communityUnlock) rewards.push(`канал ${cp.communityUnlock.name}`);

  return {
    requirement: `Баланс Pocket от ${formatThresholdUsd(cp.thresholdUsd)}`,
    rewards,
  };
}

/**
 * The report lifecycle to DISPLAY for a level, or null when there is nothing to
 * show.
 *
 * The guard that matters is `availability !== "completed"`: a report status may
 * decorate a level that is still live work, but it must never touch a level the
 * canonical sequence has already carried the user past. A browser-local draft is
 * not allowed to downgrade progression that was already earned — which is what
 * would happen if a `pending-review` marker written under the report scenario
 * bled into the canonical L18 profile (DD-271).
 */
function displayedReportLifecycle(
  levelNumber: number,
  availability: "locked" | "available" | "completed",
  reports: ReportWorkspaceStateV3,
): ReportLifecycle | null {
  if (availability === "completed") return null;
  if (!isReportLevelNumber(levelNumber)) return null;
  const draft = getStoredDraftV3(reports, levelNumber);
  return draft ? deriveReportLifecycle(draft) : null;
}

/** The row's action wording, owned here rather than re-decided in a component. */
function actionLabelFor(level: CurriculumLevel, lifecycle: ReportLifecycle | null): string {
  if (level.kind === "report") {
    return lifecycle === "pending-review" ? "Открыть отчёт" : "Перейти к отчёту";
  }
  if (level.kind === "practical") return "Перейти к заданию";
  return "Продолжить урок";
}

function buildLevelRow(
  level: CurriculumLevel,
  progress: PathProgress,
  session: LessonSessionProgress,
  reports: ReportWorkspaceStateV3,
): LibraryLevelRow {
  const isCheckpoint = level.kind === "checkpoint";

  const base = {
    code: level.code,
    number: level.number,
    title: level.title,
    kindLabel: kindLabel(level.kind),
    durationLabel: durationLabelFor(level.number),
    artifact: level.artifact ?? null,
    mentorReview: level.mentorReview,
  };

  // A checkpoint is a module boundary, not a lesson: it never has a route.
  if (isCheckpoint) {
    return {
      ...base,
      state: "checkpoint",
      statusLabel: "Граница модуля",
      href: null,
      actionLabel: null,
      checkpoint: buildCheckpointInfo(level.number),
    };
  }

  // The lesson-level truth: Путь's "available" means "next in line", which is NOT
  // an open lesson — the resolver is the only authority here (DD-256).
  const availability = resolveRouteAvailability(level.number, progress, session);

  if (availability === "completed") {
    return {
      ...base,
      state: "completed",
      statusLabel: "Завершён",
      href: lessonHref(level.number),
      actionLabel: "Пересмотреть",
      checkpoint: null,
    };
  }

  if (availability === "available") {
    const isCurrent = level.number === progress.currentLevel;
    const lifecycle = displayedReportLifecycle(level.number, availability, reports);
    return {
      ...base,
      state: isCurrent ? "current" : "available",
      // A report in progress says what it IS («Черновик» / «Готов к отправке» /
      // «На проверке») rather than the generic row status — that is the fact the
      // user came to the library for.
      statusLabel: lifecycle
        ? reportStatusLabel(lifecycle)
        : isCurrent
          ? "Текущий урок"
          : "Доступен",
      href: lessonHref(level.number),
      actionLabel: actionLabelFor(level, lifecycle),
      checkpoint: null,
    };
  }

  return {
    ...base,
    state: "locked",
    statusLabel: `Откроется после уровня ${level.number - 1}`,
    href: null,
    actionLabel: null,
    checkpoint: null,
  };
}

function buildContinueStep(
  progress: PathProgress,
  session: LessonSessionProgress,
  reports: ReportWorkspaceStateV3,
): { step: LibraryContinueStep | null; note: string | null } {
  if (progress.allCompleted) {
    return { step: null, note: "Все 100 уровней пройдены." };
  }

  const level = CURRICULUM.levels[progress.currentLevel - 1];
  if (!level) return { step: null, note: "Следующий шаг не определён." };

  // The current step is a checkpoint gate: it is not a lesson to continue, and
  // the library must not turn a money condition into a call to action.
  if (level.kind === "checkpoint") {
    return {
      step: null,
      note: `Следующий шаг — контрольная точка · Уровень ${level.number}.`,
    };
  }

  const availability = resolveRouteAvailability(level.number, progress, session);
  if (availability === "locked") {
    return { step: null, note: "Следующий урок пока закрыт последовательностью." };
  }

  const mod = getModuleForLevel(level.number);
  const lifecycle = displayedReportLifecycle(level.number, availability, reports);
  return {
    step: {
      levelNumber: level.number,
      title: level.title,
      moduleIndex: mod.index,
      moduleTitle: mod.title,
      kindLabel: kindLabel(level.kind),
      durationLabel: durationLabelFor(level.number),
      href: lessonHref(level.number),
      eyebrow: "Продолжить обучение",
      // A submitted report is not "continue" work any more — it is something to
      // look at. The href is the same read-only workspace either way.
      actionLabel: actionLabelFor(level, lifecycle),
      reportStatusLabel: lifecycle ? reportStatusLabel(lifecycle) : null,
    },
    note: null,
  };
}

/**
 * Build the whole page model.
 *
 * `marker` is the shared sequential progress (server-knowable); `session` is what
 * THIS browser session completed (client-only). The server passes an empty
 * session, so it always renders the sequence answer — the safe default — and the
 * client re-resolves after hydration without a mismatch.
 */
export function buildLessonsLibraryModel({
  moduleParam,
  marker,
  session,
  reports = emptyReportWorkspaceV3(),
}: {
  moduleParam: unknown;
  marker: PathProgress;
  session: LessonSessionProgress;
  /**
   * Browser-local report drafts (D3-B). Optional and empty by default: the
   * server has none, and the library must render its full answer without them.
   * Reports only ever ADD a status to live work — see `displayedReportLifecycle`.
   */
  reports?: ReportWorkspaceStateV3;
}): LessonsLibraryModel {
  const progress = effectiveProgress(marker, session);
  const selection = resolveSelectedModule(moduleParam, progress);
  const currentModuleIndex = getModuleForLevel(progress.currentLevel).index;

  const modules: LibraryModuleRow[] = CURRICULUM.modules.map((mod) => {
    const state = moduleAggregateState(mod.index, progress);
    return {
      code: mod.code,
      index: mod.index,
      title: mod.title,
      state,
      statusLabel: MODULE_STATE_LABEL[state],
      // the shared counter, fed the session-advanced marker — not a second rule
      completedCount: moduleCompletedCount(mod.index, progress),
      totalCount: mod.levels.length,
      href: moduleHref(mod.index),
      isSelected: mod.index === selection.index,
      isCurrent: mod.index === currentModuleIndex,
    };
  });

  const selectedModule = getModuleByIndex(selection.index);
  const levels = selectedModule.levels.map((level) =>
    buildLevelRow(level, progress, session, reports),
  );

  const { step, note } = buildContinueStep(progress, session, reports);

  return {
    continueStep: step,
    continueNote: note,
    modules,
    selected: {
      code: selectedModule.code,
      index: selectedModule.index,
      title: selectedModule.title,
      description: selectedModule.description,
      startLevel: selectedModule.startLevel,
      endLevel: selectedModule.endLevel,
      completedCount: moduleCompletedCount(selectedModule.index, progress),
      totalCount: selectedModule.levels.length,
      levels,
      hasAnyAction: levels.some((l) => l.href !== null),
    },
    currentModuleIndex,
    isModuleFallback: selection.isFallback,
    totalModules: CURRICULUM.modules.length,
    totalLevels: CURRICULUM.levels.length,
  };
}
