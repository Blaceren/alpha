"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { createLessonProgressStore } from "@/features/lesson/model/lesson-progress-store";
import {
  emptyLessonProgress,
  parseLessonProgress,
  serializeLessonProgress,
  type LessonSessionProgress,
} from "@/features/lesson/model/lesson-session-progress";

/** sessionStorage cannot change under us within this tab, so nothing to watch. */
const subscribe = () => () => {};

const EMPTY_SNAPSHOT = serializeLessonProgress(emptyLessonProgress());

/**
 * This browser session's lesson progress, safe for SSR (Phase D2C-B).
 *
 * The snapshot is the SERIALISED string, not the parsed object, for a concrete
 * reason: `useSyncExternalStore` compares snapshots by identity, and the store's
 * `read()` builds a fresh object on every call — returning it directly would
 * re-render forever. A string is stable by value, so the comparison settles.
 * (`LessonSessionGate` solves the same problem by returning a primitive state.)
 *
 * Hydration: the server snapshot is empty progress, so the server renders the
 * sequence-only answer — the safe default it is the only thing it can honestly
 * know. React uses that same value while hydrating, then swaps in the real
 * session, so there is no mismatch and no frame of a WRONG answer.
 */
export function useSessionProgress(): LessonSessionProgress {
  const getSnapshot = useCallback(
    () => serializeLessonProgress(createLessonProgressStore().read()),
    [],
  );
  const getServerSnapshot = useCallback(() => EMPTY_SNAPSHOT, []);

  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => parseLessonProgress(raw), [raw]);
}
