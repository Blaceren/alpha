"use client";

import { useEffect } from "react";
import type { LessonAction } from "@/features/lesson/hooks/use-lesson-experience";
import type { MediaPlaybackState } from "@/features/lesson/model/lesson-progress";

/** Playback clock resolution. Fixed, so the advance per tick is deterministic. */
const TICK_MS = 200;
const TICK_SECONDS = TICK_MS / 1000;

/**
 * Drives the simulated player's timeline (Phase D2B).
 *
 * The clock only runs while playback is "playing", and it advances the model by
 * a FIXED delta rather than by wall-clock difference — no Date.now(), so watch
 * progress cannot drift between runs, screenshots or test machines.
 *
 * This is the only place a timer exists in the lesson; the model itself stays
 * pure and takes the delta as an argument.
 */
export function useLessonMedia(playback: MediaPlaybackState, dispatch: (a: LessonAction) => void) {
  useEffect(() => {
    if (playback !== "playing") return;
    const id = window.setInterval(
      () => dispatch({ type: "tick", deltaSeconds: TICK_SECONDS }),
      TICK_MS,
    );
    return () => window.clearInterval(id);
  }, [playback, dispatch]);
}
