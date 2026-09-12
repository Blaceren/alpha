/**
 * Route availability resolver (Phase D2B.1).
 *
 * One place decides whether a lesson route may open, by layering exactly three
 * sources — no React component re-decides any of it:
 *
 *   1. curriculum sequence — the shared progress marker (`path-state.ts`), the
 *      same one Главная and Путь read;
 *   2. session completion — what the user actually finished in THIS browser
 *      session (`lesson-session-progress.ts`);
 *   3. deterministic scenario override — DEVELOPMENT AND TESTS ONLY. It is
 *      applied upstream (the marker a scenario implies) and no user-facing link
 *      ever carries it (DD-255).
 *
 * Ordering matters: the session may only ever OPEN a level the sequence has not
 * reached yet. It can never close one, and it can never let the user skip — the
 * session record itself is only written by finishing the predecessor.
 */

import {
  lessonAvailability,
  type LessonAvailability,
} from "@/features/lesson/model/lesson-state-machine";
import {
  isLevelCompletedInSession,
  isLevelUnlockedInSession,
  type LessonSessionProgress,
} from "@/features/lesson/model/lesson-session-progress";
import type { PathProgress } from "@/features/path/model/path-state";

/**
 * Availability from the sequence alone. This is what the SERVER can know: it
 * never reads sessionStorage, so it always renders the locked/safe default.
 */
export function baseRouteAvailability(
  levelNumber: number,
  marker: PathProgress,
): LessonAvailability {
  return lessonAvailability(levelNumber, marker);
}

/**
 * Availability once this session's completions are layered on top. This is what
 * the CLIENT resolves after mount.
 */
export function resolveRouteAvailability(
  levelNumber: number,
  marker: PathProgress,
  session: LessonSessionProgress,
): LessonAvailability {
  const base = baseRouteAvailability(levelNumber, marker);

  // The sequence already answers — the session never downgrades it.
  if (base !== "locked") return base;

  if (isLevelCompletedInSession(session, levelNumber)) return "completed";
  if (isLevelUnlockedInSession(session, levelNumber)) return "available";
  return "locked";
}

/** True when the session is what opens this level (i.e. the server said locked). */
export function isUnlockedBySession(
  levelNumber: number,
  marker: PathProgress,
  session: LessonSessionProgress,
): boolean {
  return (
    baseRouteAvailability(levelNumber, marker) === "locked" &&
    resolveRouteAvailability(levelNumber, marker, session) !== "locked"
  );
}
