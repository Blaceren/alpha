"use client";

import type { LessonDefinition, LessonSection } from "@/features/lesson/model/lesson";
import type { MediaState } from "@/features/lesson/model/lesson-progress";
import type { LessonAction } from "@/features/lesson/hooks/use-lesson-experience";
import { LessonMediaControls } from "@/features/lesson/components/lesson-media-controls";
import { LessonSchematic, focusForSection } from "@/features/lesson/components/lesson-schematic";

/** The section the playhead is inside. Deterministic; null before the first. */
export function sectionAt(sections: LessonSection[], position: number): LessonSection | null {
  let found: LessonSection | null = null;
  for (const section of sections) {
    if (position >= section.startSeconds) found = section;
  }
  return found;
}

/**
 * The lesson's main object (Phase D2B) — the media stage.
 *
 * It is a SIMULATED surface and says so: there is no approved recording yet, so
 * it drives a local timeline over the lesson's own schematic instead of loading
 * an external stream. It never imitates a buffered production player.
 *
 * Exposed as a labelled region so assistive tech can reach it directly. The
 * schematic is decorative; the section caption below carries the same meaning as
 * real text.
 */
export function LessonVideoStage({
  lesson,
  media,
  dispatch,
}: {
  lesson: LessonDefinition;
  media: MediaState;
  dispatch: (a: LessonAction) => void;
}) {
  const section = sectionAt(lesson.sections, media.currentPosition);
  const playing = media.playback === "playing";

  return (
    <section className="lvs" aria-label={lesson.media.title}>
      <div className={`lvs-frame ${playing ? "playing" : ""}`}>
        <LessonSchematic focus={focusForSection(section?.id ?? null)} />

        <p className="lvs-demo">
          <span className="lvs-dot" aria-hidden="true" />
          Демонстрационная запись
        </p>

        {media.captionsOn && section && <p className="lvs-caption">{section.body}</p>}
      </div>

      {/* The chapter sits UNDER the frame, not over it: an overlay covered the
          schematic at mobile widths (D2B visual QA, finding 6). */}
      <p className="lvs-chapter">
        <span className="lvs-chapter-k">Сейчас</span>
        <span className="lvs-chapter-v">{section ? section.title : "Начало урока"}</span>
      </p>

      <LessonMediaControls
        media={media}
        captionsAvailable={lesson.media.captionsAvailable}
        dispatch={dispatch}
      />

      <ul className="lvs-legend">
        <li>
          <span className="lg-sw res" aria-hidden="true" />
          Область сопротивления — где цена ранее переставала расти
        </li>
        <li>
          <span className="lg-sw sup" aria-hidden="true" />
          Область поддержки — где цена ранее переставала снижаться
        </li>
      </ul>

      <p className="lvs-note">{lesson.media.provisionalNote}</p>
    </section>
  );
}
