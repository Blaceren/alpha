/**
 * Lesson state machine (Phase D2B). The single owner of lesson business logic —
 * components read derived state from here and never re-decide a rule.
 *
 * Composition: media watch progress (lesson-progress.ts) + assessment progress
 * (assessment.ts) + the sequential progress marker shared with Путь
 * (path-state.ts) → one derived LessonExperience.
 *
 * Raw enum values are never rendered; every user-facing string comes from the
 * label helpers at the bottom of this file.
 */

import type { LessonDefinition } from "@/features/lesson/model/lesson";
import {
  createMediaState,
  hasReachedThreshold,
  mediaProgressState,
  watchProgressPercent,
  type MediaProgressState,
  type MediaState,
} from "@/features/lesson/model/lesson-progress";
import {
  allRequiredAnswered,
  assessmentState,
  createAssessmentProgress,
  questionPosition,
  type AssessmentProgress,
  type AssessmentState,
} from "@/features/lesson/model/assessment";
import { getLevel } from "@/data/curriculum/fixture";
import { levelProgressState, type PathProgress } from "@/features/path/model/path-state";

/** Whether this level's lesson may be opened at all. */
export type LessonAvailability = "locked" | "available" | "completed";

/** The lesson experience as a whole. */
export type LessonExperienceState =
  | "locked"
  | "available"
  | "watching"
  | "test_unlocked"
  | "testing"
  | "completed";

/** Mutable session state. Lives only in the current runtime (no persistence). */
export interface LessonSession {
  media: MediaState;
  assessment: AssessmentProgress;
}

export interface LessonExperience {
  lesson: LessonDefinition;
  session: LessonSession;
  availability: LessonAvailability;
  state: LessonExperienceState;
  mediaProgress: MediaProgressState;
  assessment: AssessmentState;
  /** Verified watch percent, 0–100. */
  watchPercent: number;
  /** True once verified watch >= the rule's unlock percent. */
  testUnlocked: boolean;
  /** True once every required question is answered correctly. */
  assessmentComplete: boolean;
  /** True when the whole completion rule is satisfied. */
  lessonComplete: boolean;
  question: { position: number; total: number };
  /** The next level number, or null at the end of the curriculum. */
  nextLevelNumber: number | null;
  /** The next lesson is reachable ONLY after this lesson is complete. */
  nextLessonUnlocked: boolean;
}

export function createLessonSession(lesson: LessonDefinition): LessonSession {
  return {
    media: createMediaState(lesson.media.durationSeconds),
    assessment: createAssessmentProgress(),
  };
}

/* ------------------------------------------------------------------ *
 * Availability
 * ------------------------------------------------------------------ */

/**
 * Availability from the shared sequential marker, refined by what happened in
 * this session: finishing L18 here makes L18 completed without inventing any
 * persisted progress.
 */
export function lessonAvailability(
  levelNumber: number,
  progress: PathProgress,
  completedInSession = false,
): LessonAvailability {
  if (completedInSession) return "completed";
  switch (levelProgressState(levelNumber, progress)) {
    case "completed":
      return "completed";
    case "current":
      return "available";
    default:
      // "available" on Путь means "next in line", which is NOT an open lesson:
      // the next lesson stays closed until the current one is complete (DD-062).
      return "locked";
  }
}

/** Why a lesson is locked, in plain RU. Sequence only — never a money condition. */
export function lockedLessonReason(levelNumber: number, progress: PathProgress): string {
  const current = getLevel(progress.currentLevel);
  return `Сначала нужно завершить уровень ${current.number} «${current.title}».`;
}

/* ------------------------------------------------------------------ *
 * Derivation
 * ------------------------------------------------------------------ */

export function deriveLessonExperience(
  lesson: LessonDefinition,
  session: LessonSession,
  progress: PathProgress,
): LessonExperience {
  const rule = lesson.completionRule;
  const watchPercent = watchProgressPercent(session.media);
  const testUnlocked = hasReachedThreshold(session.media, rule.unlockWatchPercent);
  const assessmentComplete = allRequiredAnswered(lesson.assessment, session.assessment);
  const lessonComplete = testUnlocked && assessmentComplete;

  const availability = lessonAvailability(lesson.level.number, progress, lessonComplete);
  const assessment = assessmentState(lesson.assessment, session.assessment, testUnlocked);

  const nextLevelNumber = lesson.level.number < 100 ? lesson.level.number + 1 : null;

  return {
    lesson,
    session,
    availability,
    state: experienceState(availability, session, testUnlocked, lessonComplete, watchPercent),
    mediaProgress: mediaProgressState(session.media, rule.unlockWatchPercent),
    assessment,
    watchPercent,
    testUnlocked,
    assessmentComplete,
    lessonComplete,
    question: questionPosition(lesson.assessment, session.assessment),
    nextLevelNumber,
    nextLessonUnlocked: lessonComplete && nextLevelNumber !== null,
  };
}

function experienceState(
  availability: LessonAvailability,
  session: LessonSession,
  testUnlocked: boolean,
  lessonComplete: boolean,
  watchPercent: number,
): LessonExperienceState {
  if (availability === "locked") return "locked";
  if (lessonComplete) return "completed";
  if (testUnlocked) return session.assessment.started ? "testing" : "test_unlocked";
  if (watchPercent > 0) return "watching";
  return "available";
}

/* ------------------------------------------------------------------ *
 * Labels — the only user-facing strings for these states.
 * ------------------------------------------------------------------ */

export function lessonStateLabel(state: LessonExperienceState): string {
  switch (state) {
    case "locked":
      return "закрыт";
    case "available":
      return "не начат";
    case "watching":
      return "идёт просмотр";
    case "test_unlocked":
      return "проверка открыта";
    case "testing":
      return "идёт проверка";
    case "completed":
      return "завершён";
  }
}

export function assessmentStateLabel(state: AssessmentState): string {
  switch (state) {
    case "locked":
      return "закрыта";
    case "ready":
      return "доступна";
    case "answering":
      return "идёт ответ";
    case "feedback_correct":
      return "ответ верный";
    case "feedback_incorrect":
      return "ответ пока не тот";
    case "completed":
      return "пройдена";
  }
}
