/**
 * Lesson dev-scenario adapter (Phase D2B).
 *
 * Deterministic entry states for /lessons/[levelCode]?scenario=… so every lesson
 * state can be opened directly by QA, screenshots and E2E. Unknown → "initial".
 *
 * This adapter is DEVELOPMENT-ONLY plumbing and is kept out of the production
 * domain model (lesson-state-machine.ts / assessment.ts / lesson-progress.ts):
 * it only SEEDS a starting session, then the real state machine takes over.
 * It is invisible to the user — no debug panel, no state switcher, no query
 * echoed into the UI. It is not persistence: nothing survives the request.
 */

import type { LessonDefinition } from "@/features/lesson/model/lesson";
import { createAssessmentProgress, correctOptionId, type AssessmentProgress } from "@/features/lesson/model/assessment";
import { createMediaState, stateAtVerifiedPercent } from "@/features/lesson/model/lesson-progress";
import type { LessonSession } from "@/features/lesson/model/lesson-state-machine";
import { getPathProgress, type PathProgress } from "@/features/path/model/path-state";

export type LessonScenario =
  | "initial"
  | "watching"
  | "threshold-49"
  | "threshold-50"
  | "testing"
  | "incorrect"
  | "completed"
  | "locked"
  | "unlocked";

const SCENARIOS: readonly LessonScenario[] = [
  "initial",
  "watching",
  "threshold-49",
  "threshold-50",
  "testing",
  "incorrect",
  "completed",
  "locked",
  "unlocked",
];

/** Unknown / missing / malformed input falls back to "initial" — never throws. */
export function resolveLessonScenario(raw: unknown): LessonScenario {
  return typeof raw === "string" && (SCENARIOS as readonly string[]).includes(raw)
    ? (raw as LessonScenario)
    : "initial";
}

/**
 * The sequential progress marker a scenario implies. "unlocked" is the only one
 * that advances the marker past 18 — it represents a user who has finished L18,
 * which is exactly what the next-lesson gate needs to be verifiable from both
 * sides. Everything else keeps the canonical marker (Артём on level 18).
 */
export function scenarioProgress(scenario: LessonScenario): PathProgress {
  const active = getPathProgress("active");
  if (scenario === "unlocked") return { ...active, currentLevel: 19 };
  return active;
}

/** The session a scenario starts from. Deterministic — no Date.now/Math.random. */
export function scenarioSession(
  lesson: LessonDefinition,
  scenario: LessonScenario,
): LessonSession {
  const duration = lesson.media.durationSeconds;
  const questions = lesson.assessment.questions;

  switch (scenario) {
    case "watching":
      return {
        media: stateAtVerifiedPercent(duration, 25, { playback: "paused" }),
        assessment: createAssessmentProgress(),
      };

    case "threshold-49":
      return {
        media: stateAtVerifiedPercent(duration, 49, { playback: "paused" }),
        assessment: createAssessmentProgress(),
      };

    case "threshold-50":
      return {
        media: stateAtVerifiedPercent(duration, 50, { playback: "paused" }),
        assessment: createAssessmentProgress(),
      };

    case "testing":
      return {
        media: stateAtVerifiedPercent(duration, 60, { playback: "paused" }),
        assessment: createAssessmentProgress({ started: true }),
      };

    case "incorrect": {
      // Deterministically pick the first option that is not the correct one.
      const first = questions[0];
      const wrong = first?.options.find((o) => !o.correct);
      const progress: AssessmentProgress = createAssessmentProgress({
        started: true,
        selectedOptionId: wrong?.id ?? null,
        submittedOptionId: wrong?.id ?? null,
      });
      return {
        media: stateAtVerifiedPercent(duration, 60, { playback: "paused" }),
        assessment: progress,
      };
    }

    case "completed": {
      const last = questions[questions.length - 1];
      const lastCorrect = last ? correctOptionId(last) : null;
      return {
        media: stateAtVerifiedPercent(duration, 60, { playback: "paused" }),
        assessment: createAssessmentProgress({
          started: true,
          currentIndex: questions.length - 1,
          selectedOptionId: lastCorrect,
          submittedOptionId: lastCorrect,
          answeredCorrectly: questions.map((q) => q.id),
        }),
      };
    }

    case "initial":
    case "locked":
    case "unlocked":
    default:
      return {
        media: createMediaState(duration),
        assessment: createAssessmentProgress(),
      };
  }
}
