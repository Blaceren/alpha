"use client";

import { formatDuration } from "@/features/lesson/model/lesson";
import type { LessonSection } from "@/features/lesson/model/lesson";

/**
 * Lesson structure (Phase D2B) — the chapters of the material with their start
 * marks, and which one the playhead is inside.
 *
 * Read-only on purpose: these are NOT seek shortcuts. Jumping to a chapter would
 * move the playhead without watching it, which credits nothing (see
 * lesson-progress.ts) and would only look like a broken unlock. The current
 * chapter is marked with a word as well as a dot.
 */
export function LessonOutline({
  sections,
  activeSectionId,
}: {
  sections: LessonSection[];
  activeSectionId: string | null;
}) {
  return (
    <ol className="lol">
      {sections.map((section) => {
        const active = section.id === activeSectionId;
        return (
          <li key={section.id} className={active ? "on" : ""}>
            <span className="lol-dot" aria-hidden="true" />
            <span className="lol-title">{section.title}</span>
            <span className="lol-at">{formatDuration(section.startSeconds)}</span>
            {active && <span className="lol-now">сейчас</span>}
          </li>
        );
      })}
    </ol>
  );
}
