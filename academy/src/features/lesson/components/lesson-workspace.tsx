"use client";

import { useEffect, useRef, useState } from "react";
import type { LessonDefinition } from "@/features/lesson/model/lesson";
import type { LessonSession } from "@/features/lesson/model/lesson-state-machine";
import { lessonStateLabel } from "@/features/lesson/model/lesson-state-machine";
import type { PathProgress } from "@/features/path/model/path-state";
import { createLessonProgressStore } from "@/features/lesson/model/lesson-progress-store";
import { withCompletedLevel } from "@/features/lesson/model/lesson-session-progress";
import { useLessonExperience } from "@/features/lesson/hooks/use-lesson-experience";
import { useLessonMedia } from "@/features/lesson/hooks/use-lesson-media";
import { LessonHeader } from "@/features/lesson/components/lesson-header";
import { LessonAccessibleOutline } from "@/features/lesson/components/lesson-accessible-outline";
import { LessonVideoStage } from "@/features/lesson/components/lesson-video-stage";
import { LessonWatchProgress } from "@/features/lesson/components/lesson-watch-progress";
import { LessonContext } from "@/features/lesson/components/lesson-context";
import { LessonAssessment } from "@/features/lesson/components/lesson-assessment";
import { LessonCompletion } from "@/features/lesson/components/lesson-completion";
import { LessonNavigation } from "@/features/lesson/components/lesson-navigation";

/**
 * Урок — the Learning Spine workspace (Phase D2B).
 *
 * Composition: one vertical spine threads the stages of a single learning step —
 * video → проверка понимания → завершение → переходы. This is deliberately NOT
 * another Route Field page: Главная is the current moment, Путь is the spatial
 * map of the programme, and Урок is one step, followed through. The media stage
 * is the one dominant object; the rail stays thin metadata.
 *
 * DOM order is the learning order (video before test, always), and the same
 * order is the mobile order — the desktop rail is placed by grid, not by a
 * second copy of the markup.
 *
 * All rules come from the state machine; this component only renders and routes
 * events. State is session-only — nothing is persisted or claimed to be saved.
 */
export function LessonWorkspace({
  lesson,
  initialSession,
  progress,
}: {
  lesson: LessonDefinition;
  initialSession: LessonSession;
  progress: PathProgress;
}) {
  const { experience, dispatch } = useLessonExperience(lesson, initialSession, progress);
  useLessonMedia(experience.session.media.playback, dispatch);
  useRecordCompletion(experience.lessonComplete, lesson.level.number);

  const announcement = useAnnouncement(experience.testUnlocked, experience.lessonComplete);

  return (
    <div className="lesson-page">
      <LessonAccessibleOutline experience={experience} />

      <LessonHeader
        level={lesson.level}
        goal={lesson.goal}
        stateLabel={lessonStateLabel(experience.state)}
      />

      {/* Restrained status channel: the unlock and the completion are announced
          once, politely. Focus is never moved by them. */}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="lesson-body">
        <div className="lvs-wrap stage">
          <span className="stage-node current" aria-hidden="true" />
          <LessonVideoStage
            lesson={lesson}
            media={experience.session.media}
            dispatch={dispatch}
          />
          <LessonWatchProgress
            percent={experience.watchPercent}
            thresholdPercent={lesson.completionRule.unlockWatchPercent}
            durationSeconds={lesson.media.durationSeconds}
            unlocked={experience.testUnlocked}
          />
        </div>

        <LessonContext experience={experience} />

        <LessonAssessment experience={experience} dispatch={dispatch} />

        {experience.lessonComplete && <LessonCompletion experience={experience} />}

        <LessonNavigation experience={experience} />
      </div>
    </div>
  );
}

/**
 * Persist the completion into THIS browser session (D2B.1), so the next level is
 * reachable by a clean link instead of a dev scenario query (DD-255).
 *
 * Runs only on completion and is idempotent, so re-renders cannot grow or
 * corrupt the record. This is session-scoped state, not backend persistence —
 * nothing is sent anywhere and the UI never claims it was saved.
 */
function useRecordCompletion(lessonComplete: boolean, levelNumber: number) {
  useEffect(() => {
    if (!lessonComplete) return;
    const store = createLessonProgressStore();
    store.write(withCompletedLevel(store.read(), levelNumber));
  }, [lessonComplete, levelNumber]);
}

/**
 * Announce the two moments that change what the user can do. Returns "" until a
 * transition actually happens, so nothing is read out on load.
 */
function useAnnouncement(testUnlocked: boolean, lessonComplete: boolean): string {
  const [message, setMessage] = useState("");
  const prev = useRef({ testUnlocked, lessonComplete });

  useEffect(() => {
    const was = prev.current;
    if (lessonComplete && !was.lessonComplete) {
      setMessage("Урок завершён. Ниже — возврат в Путь и переход к следующему уровню.");
    } else if (testUnlocked && !was.testUnlocked) {
      setMessage("Проверка понимания открыта — она находится под видео.");
    }
    prev.current = { testUnlocked, lessonComplete };
  }, [testUnlocked, lessonComplete]);

  return message;
}
