"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { createLessonProgressStore } from "@/features/lesson/model/lesson-progress-store";
import { resolveRouteAvailability } from "@/features/lesson/model/lesson-availability";
import type { PathProgress } from "@/features/path/model/path-state";

type GateState = "resolving" | "locked" | "unlocked";

/** sessionStorage cannot change under us within this tab, so nothing to watch. */
const subscribe = () => () => {};

/**
 * Decides a locked-by-sequence route against THIS browser session (Phase D2B.1).
 *
 * Only levels the server considers locked reach this gate; everything the
 * sequence already opens is rendered directly, so the common path (the current
 * lesson) never waits on storage.
 *
 * Hydration: `sessionStorage` is unreadable on the server, so this reads the
 * store through `useSyncExternalStore` — the server snapshot is `resolving` and
 * the client snapshot is the real answer. React swaps them after hydration
 * without a mismatch, and the user never sees a frame of the WRONG answer
 * ("закрыт" before "открыт"). Both outcomes are server-rendered subtrees passed
 * in as props, so the model is never serialised and the decision lives in
 * exactly one place.
 */
export function LessonSessionGate({
  levelNumber,
  marker,
  resolving,
  locked,
  unlocked,
}: {
  levelNumber: number;
  marker: PathProgress;
  resolving: ReactNode;
  locked: ReactNode;
  unlocked: ReactNode;
}) {
  // Returns a primitive, so React's snapshot comparison is stable by value.
  const getSnapshot = useCallback((): GateState => {
    const session = createLessonProgressStore().read();
    return resolveRouteAvailability(levelNumber, marker, session) === "locked"
      ? "locked"
      : "unlocked";
  }, [levelNumber, marker]);

  const getServerSnapshot = useCallback((): GateState => "resolving", []);

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (state === "resolving") return <>{resolving}</>;
  return <>{state === "unlocked" ? unlocked : locked}</>;
}
