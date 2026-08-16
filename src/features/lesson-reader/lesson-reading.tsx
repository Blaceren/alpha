"use client";

/**
 * THE READING SURFACE — sections, outline and the learner's own position.
 *
 * WHY THIS IS A CLIENT COMPONENT, AND ONLY THIS PART. Everything above it —
 * the coordinate, the title, the objective, the canonical state sentence — is
 * server-rendered from canonical data and never changes while the learner reads.
 * This part is interactive because marking a section read is a WRITE, and
 * because the outline has to show which section is current. Nothing else was
 * pulled into the client for company.
 *
 * WHAT "ПРОЧИТАНО" MEANS, STATED WHERE THE LEARNER CAN SEE IT (§11).
 * Marking a section read moves a reading position. It does not complete the
 * level, and the copy says so beside the control rather than in a tooltip. The
 * Backend agrees: the command behind it writes a different row from the one that
 * completes levels and refuses to run at all once a level is finished. So the
 * worst case if a learner misunderstands is that they mark a section and nothing
 * happens to their progression — which is the truth.
 *
 * OPTIMISTIC, BUT NEVER LYING. The mark appears immediately and is reverted if
 * the server refuses. A refusal is shown once, quietly, and reading continues:
 * losing a reading position is not worth interrupting a lesson for.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { LessonBody } from "@/lib/curriculum/lesson-body";
import {
  newLessonProgressRequestId,
  saveLessonReadingProgress,
} from "@/lib/curriculum/lesson-progress-client";
import { LessonBlockView } from "@/features/lesson-reader/lesson-blocks";

export type ReadingState = {
  readonly revision: number;
  readonly completedSections: readonly string[];
  readonly activeSectionCode: string | null;
};

export function LessonReading({
  body,
  stableCode,
  levelHref,
  nextLevelHref,
  initialReading,
  /**
   * Whether the canonical level is open for reading progress at all.
   *
   * The Backend accepts a save only while the level is `in_progress`. A
   * completed level, a level not yet started and every non-lesson level are all
   * read-only here — the text stays fully readable, the controls simply are not
   * offered, because offering one that the server will refuse is a promise the
   * page cannot keep.
   */
  canTrackReading,
  playbackPositionSeconds,
}: {
  body: LessonBody;
  stableCode: string;
  levelHref: string;
  nextLevelHref: string | null;
  initialReading: ReadingState | null;
  canTrackReading: boolean;
  playbackPositionSeconds: number;
}) {
  const [reading, setReading] = useState<ReadingState>(
    initialReading ?? { revision: 0, completedSections: [], activeSectionCode: null },
  );
  const [note, setNote] = useState<string | null>(null);
  const inFlight = useRef(false);

  const done = useMemo(() => new Set(reading.completedSections), [reading.completedSections]);
  const total = body.sections.length;
  const readCount = body.sections.filter((section) => done.has(section.code)).length;

  /**
   * The section to resume from: the server's own active marker when it still
   * names a section of this lesson, otherwise the first unread one. Never a
   * separate resume engine — this reads the canonical position and picks the
   * earliest thing the learner has not finished.
   */
  const resumeCode = useMemo(() => {
    const active = reading.activeSectionCode;
    if (active && body.sections.some((section) => section.code === active) && !done.has(active)) {
      return active;
    }
    return body.sections.find((section) => !done.has(section.code))?.code ?? null;
  }, [reading.activeSectionCode, body.sections, done]);

  const toggle = useCallback(
    async (code: string) => {
      if (!canTrackReading || inFlight.current) return;
      inFlight.current = true;
      setNote(null);

      const previous = reading;
      const nextCompleted = done.has(code)
        ? reading.completedSections.filter((entry) => entry !== code)
        : [...reading.completedSections, code];
      // The next unread section becomes active, so a resume after a pause lands
      // where the learner actually stopped.
      const nextActive =
        body.sections.find((section) => !nextCompleted.includes(section.code))?.code ?? null;

      setReading({ ...reading, completedSections: nextCompleted, activeSectionCode: nextActive });

      const result = await saveLessonReadingProgress(
        stableCode,
        {
          expectedRevision: reading.revision,
          completedSections: nextCompleted,
          activeSectionCode: nextActive,
          playbackPositionSeconds,
        },
        newLessonProgressRequestId(),
      );
      inFlight.current = false;

      if (!result.ok) {
        // Reverted: the page must never show a position the server rejected.
        setReading(previous);
        setNote("Не удалось сохранить отметку. Материал остаётся доступным.");
        return;
      }
      setReading({
        revision: result.data.acceptedRevision,
        completedSections: result.data.completedSections,
        activeSectionCode: result.data.activeSectionCode,
      });
    },
    [canTrackReading, reading, done, body.sections, stableCode, playbackPositionSeconds],
  );

  return (
    <>
      <nav className="lr-outline" aria-label="Содержание урока">
        <p className="lr-outline__title">Содержание</p>
        <ol className="lr-outline__list">
          {body.sections.map((section, index) => {
            const isRead = done.has(section.code);
            return (
              <li
                className="lr-outline__item"
                key={section.code}
                data-read={isRead ? "true" : "false"}
                data-resume={section.code === resumeCode ? "true" : "false"}
              >
                <a href={`#${section.code}`}>
                  <span className="lr-outline__n">{index + 1}</span>
                  <span className="lr-outline__t">{section.title}</span>
                </a>
              </li>
            );
          })}
        </ol>
        {canTrackReading ? (
          <p className="lr-outline__meta">
            Прочитано {readCount} из {total}
            {/* The §11 sentence, at the place the count is shown. */}
            <span className="lr-outline__note">
              Отметки о чтении не завершают уровень — его засчитывает проверка ниже.
            </span>
          </p>
        ) : null}
      </nav>

      {body.sections.map((section, index) => {
        const isRead = done.has(section.code);
        return (
          <section
            className="lr-section"
            id={section.code}
            key={section.code}
            data-read={isRead ? "true" : "false"}
            aria-labelledby={`h-${section.code}`}
          >
            <p className="lr-section__n">Раздел {index + 1}</p>
            <h2 className="lr-section__title" id={`h-${section.code}`}>
              {section.title}
            </h2>
            {section.blocks.map((block, blockIndex) => (
              <LessonBlockView
                block={block}
                key={blockIndex}
                levelHref={levelHref}
                nextLevelHref={nextLevelHref}
              />
            ))}
            {canTrackReading ? (
              <button
                type="button"
                className="lr-section__mark"
                onClick={() => void toggle(section.code)}
                aria-pressed={isRead}
              >
                {isRead ? "Прочитано" : "Отметить прочитанным"}
              </button>
            ) : null}
          </section>
        );
      })}

      {body.appendix.length > 0 ? (
        <section className="lr-section" aria-label="Дополнительно">
          {body.appendix.map((block, index) => (
            <LessonBlockView
              block={block}
              key={index}
              levelHref={levelHref}
              nextLevelHref={nextLevelHref}
            />
          ))}
        </section>
      ) : null}

      <p className="lr-savenote" role="status">
        {note ?? ""}
      </p>
    </>
  );
}
