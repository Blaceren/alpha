/**
 * Session-scoped lesson progress (Phase D2B.1). Pure, deterministic, no I/O.
 *
 * WHAT THIS IS: the honest frontend-only record of what the user finished in the
 * CURRENT browser session. It exists so progression stops depending on the dev
 * scenario query — a development adapter must never be the user's unlock
 * mechanism (DD-255).
 *
 * WHAT THIS IS NOT: backend persistence. It is not a server, not a database and
 * not durable storage. Closing the browser session may lose it, and that is the
 * honest boundary of a frontend-only prototype — the UI says exactly that and
 * never claims anything was saved or synced.
 *
 * Storage lives in `lesson-progress-store.ts`; this module only knows the shape
 * and the rules, so every parse path is unit-testable without a browser.
 *
 * Deliberately NOT stored: XP, any financial value, balances, the user's answers
 * beyond the fact of completion, curriculum copy, and debug scenarios.
 */

import { levelCodeFor, parseLevelCode } from "@/features/lesson/model/lesson";

/** Versioned key: a schema change gets a new key rather than a silent migration. */
export const LESSON_PROGRESS_STORAGE_KEY = "ata.lesson-progress.v1";

/** Schema version carried inside the payload; anything else is discarded. */
export const LESSON_PROGRESS_VERSION = 1;

export interface LessonSessionProgress {
  version: number;
  /** Stable level codes finished in this session, e.g. ["level.018"]. */
  completed: string[];
  /** Stable level codes opened by finishing their predecessor. */
  unlocked: string[];
}

export function emptyLessonProgress(): LessonSessionProgress {
  return { version: LESSON_PROGRESS_VERSION, completed: [], unlocked: [] };
}

/** Keep only canonical `level.NNN` codes, deduped and ordered — no junk survives. */
function sanitizeCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const valid = value.filter(
    (entry): entry is string => typeof entry === "string" && parseLevelCode(entry) !== null,
  );
  return [...new Set(valid)].sort();
}

/**
 * Parse a raw stored string. NEVER throws and never returns junk: corrupt JSON,
 * a wrong shape, an unknown version or poisoned entries all collapse to empty
 * progress, so a tampered value can only ever lock the user out, never unlock.
 */
export function parseLessonProgress(raw: string | null | undefined): LessonSessionProgress {
  if (typeof raw !== "string" || raw.length === 0) return emptyLessonProgress();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyLessonProgress();
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return emptyLessonProgress();
  }

  const record = parsed as Record<string, unknown>;
  if (record.version !== LESSON_PROGRESS_VERSION) return emptyLessonProgress();

  return {
    version: LESSON_PROGRESS_VERSION,
    completed: sanitizeCodes(record.completed),
    unlocked: sanitizeCodes(record.unlocked),
  };
}

export function serializeLessonProgress(progress: LessonSessionProgress): string {
  return JSON.stringify({
    version: LESSON_PROGRESS_VERSION,
    completed: sanitizeCodes(progress.completed),
    unlocked: sanitizeCodes(progress.unlocked),
  });
}

/**
 * Record a finished level and open the next one. Idempotent: replaying the same
 * completion yields an equal record, so the write effect can fire on every
 * render without growing the payload.
 */
export function withCompletedLevel(
  progress: LessonSessionProgress,
  levelNumber: number,
): LessonSessionProgress {
  if (!Number.isInteger(levelNumber) || levelNumber < 1 || levelNumber > 100) return progress;

  const code = levelCodeFor(levelNumber);
  const next = levelNumber < 100 ? levelCodeFor(levelNumber + 1) : null;

  const completed = [...new Set([...progress.completed, code])].sort();
  const unlocked = [...new Set(next ? [...progress.unlocked, next] : progress.unlocked)].sort();

  return { version: LESSON_PROGRESS_VERSION, completed, unlocked };
}

export function isLevelCompletedInSession(
  progress: LessonSessionProgress,
  levelNumber: number,
): boolean {
  return progress.completed.includes(levelCodeFor(levelNumber));
}

export function isLevelUnlockedInSession(
  progress: LessonSessionProgress,
  levelNumber: number,
): boolean {
  return progress.unlocked.includes(levelCodeFor(levelNumber));
}
