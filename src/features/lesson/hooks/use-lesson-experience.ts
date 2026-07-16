"use client";

import { useCallback, useMemo, useReducer } from "react";
import type { LessonDefinition } from "@/features/lesson/model/lesson";
import * as media from "@/features/lesson/model/lesson-progress";
import * as quiz from "@/features/lesson/model/assessment";
import {
  deriveLessonExperience,
  type LessonExperience,
  type LessonSession,
} from "@/features/lesson/model/lesson-state-machine";
import type { PathProgress } from "@/features/path/model/path-state";

/**
 * The lesson session reducer (Phase D2B).
 *
 * All rules live in the model modules — this hook only routes actions into them
 * and re-derives the experience. State exists for the lifetime of the page only:
 * nothing is written to a server, a database or localStorage, and no "saved"
 * claim is ever made to the user (DD-250).
 */
export type LessonAction =
  | { type: "play" }
  | { type: "pause" }
  | { type: "toggle-play" }
  | { type: "seek"; position: number }
  | { type: "tick"; deltaSeconds: number }
  | { type: "toggle-muted" }
  | { type: "toggle-captions" }
  | { type: "start-assessment" }
  | { type: "select"; optionId: string }
  | { type: "submit" }
  | { type: "retry" }
  | { type: "next-question" };

function reducer(
  state: LessonSession,
  action: LessonAction,
  lesson: LessonDefinition,
): LessonSession {
  const unlocked = media.hasReachedThreshold(state.media, lesson.completionRule.unlockWatchPercent);

  switch (action.type) {
    case "play":
      return { ...state, media: media.play(state.media) };
    case "pause":
      return { ...state, media: media.pause(state.media) };
    case "toggle-play":
      return { ...state, media: media.togglePlay(state.media) };
    case "seek":
      return { ...state, media: media.seek(state.media, action.position) };
    case "tick":
      return { ...state, media: media.tick(state.media, action.deltaSeconds) };
    case "toggle-muted":
      return { ...state, media: media.toggleMuted(state.media) };
    case "toggle-captions":
      return { ...state, media: media.toggleCaptions(state.media) };
    case "start-assessment":
      return { ...state, assessment: quiz.start(state.assessment, unlocked) };
    case "select":
      return { ...state, assessment: quiz.select(state.assessment, action.optionId) };
    case "submit":
      return { ...state, assessment: quiz.submit(lesson.assessment, state.assessment, unlocked) };
    case "retry":
      return { ...state, assessment: quiz.retry(lesson.assessment, state.assessment) };
    case "next-question":
      return { ...state, assessment: quiz.next(lesson.assessment, state.assessment) };
    default:
      return state;
  }
}

export interface LessonExperienceApi {
  experience: LessonExperience;
  dispatch: (action: LessonAction) => void;
}

export function useLessonExperience(
  lesson: LessonDefinition,
  initialSession: LessonSession,
  progress: PathProgress,
): LessonExperienceApi {
  const [session, rawDispatch] = useReducer(
    (state: LessonSession, action: LessonAction) => reducer(state, action, lesson),
    initialSession,
  );

  const dispatch = useCallback((action: LessonAction) => rawDispatch(action), []);

  const experience = useMemo(
    () => deriveLessonExperience(lesson, session, progress),
    [lesson, session, progress],
  );

  return { experience, dispatch };
}
