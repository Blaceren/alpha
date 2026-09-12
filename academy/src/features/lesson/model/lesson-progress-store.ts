/**
 * Lesson progress storage (Phase D2B.1) — the only module that touches Web
 * Storage. The rules live in `lesson-session-progress.ts`; this is the port.
 *
 * `sessionStorage`, deliberately NOT `localStorage`: progress must not outlive
 * the browser session, because there is no backend to reconcile it with and a
 * durable-looking record would imply a persistence the product does not have
 * (DD-255).
 *
 * Every operation is defensive. Storage can be unavailable (SSR, private mode,
 * disabled cookies, quota) and its contents can be corrupt or hostile; none of
 * that may break the route. A failure always degrades to "no progress", which is
 * the locked/safe direction.
 */

import {
  LESSON_PROGRESS_STORAGE_KEY,
  emptyLessonProgress,
  parseLessonProgress,
  serializeLessonProgress,
  type LessonSessionProgress,
} from "@/features/lesson/model/lesson-session-progress";

export interface LessonProgressStore {
  read(): LessonSessionProgress;
  write(progress: LessonSessionProgress): void;
  clear(): void;
}

/** Real store, backed by the current tab's sessionStorage. */
export class BrowserSessionLessonProgressStore implements LessonProgressStore {
  private readonly storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  read(): LessonSessionProgress {
    let raw: string | null;
    try {
      raw = this.storage.getItem(LESSON_PROGRESS_STORAGE_KEY);
    } catch {
      return emptyLessonProgress();
    }

    const progress = parseLessonProgress(raw);

    // A value we could not make sense of is dropped rather than left to rot:
    // the next write starts from a clean, valid record.
    if (raw !== null && progress.completed.length === 0 && progress.unlocked.length === 0) {
      const looksEmpty = raw === serializeLessonProgress(emptyLessonProgress());
      if (!looksEmpty) this.clear();
    }

    return progress;
  }

  write(progress: LessonSessionProgress): void {
    try {
      this.storage.setItem(LESSON_PROGRESS_STORAGE_KEY, serializeLessonProgress(progress));
    } catch {
      // Storage full or blocked — progress simply does not carry. Never throw
      // into the render tree over a prototype convenience.
    }
  }

  clear(): void {
    try {
      this.storage.removeItem(LESSON_PROGRESS_STORAGE_KEY);
    } catch {
      /* nothing to do */
    }
  }
}

/** In-memory store: the server, and any test that wants no browser. */
export class MemoryLessonProgressStore implements LessonProgressStore {
  private progress: LessonSessionProgress = emptyLessonProgress();

  read(): LessonSessionProgress {
    return this.progress;
  }

  write(progress: LessonSessionProgress): void {
    this.progress = progress;
  }

  clear(): void {
    this.progress = emptyLessonProgress();
  }
}

/**
 * The store for the current environment. On the server there is no session, so
 * this returns an empty in-memory store — `sessionStorage` is never read during
 * SSR, and the server therefore always renders the locked/safe default.
 */
export function createLessonProgressStore(): LessonProgressStore {
  if (typeof window === "undefined") return new MemoryLessonProgressStore();
  try {
    return new BrowserSessionLessonProgressStore(window.sessionStorage);
  } catch {
    // Accessing sessionStorage can itself throw (blocked storage).
    return new MemoryLessonProgressStore();
  }
}
