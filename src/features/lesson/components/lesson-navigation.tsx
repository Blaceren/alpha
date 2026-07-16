import Link from "next/link";
import { getLevel } from "@/data/curriculum/fixture";
import { levelCodeFor } from "@/features/lesson/model/lesson";
import type { LessonExperience } from "@/features/lesson/model/lesson-state-machine";

/**
 * Where the lesson can lead (Phase D2B).
 *
 * Путь is always reachable. The NEXT level is not: before completion there is no
 * link at all — only a sentence saying what opens it — so the gate cannot be
 * clicked past, and after completion the link appears here and nowhere else.
 *
 * The next-level link carries the dev scenario that represents "L18 finished",
 * because this prototype has no backend to advance the progress marker. That is
 * the documented dev adapter (see lesson-scenarios.ts), not fake persistence.
 */
export function LessonNavigation({ experience }: { experience: LessonExperience }) {
  const { lessonComplete, nextLevelNumber, nextLessonUnlocked, lesson } = experience;
  const next = nextLevelNumber !== null ? getLevel(nextLevelNumber) : null;

  return (
    <section className="lnav stage" aria-labelledby="nav-heading">
      <span className="stage-node" aria-hidden="true" />
      <h2 id="nav-heading" className="sr-only">
        Переходы после урока
      </h2>

      <div className="lnav-row">
        <Link href="/path" className="lnav-back">
          <span aria-hidden="true">←</span> Вернуться в Путь
        </Link>

        {next && nextLessonUnlocked && (
          <Link href={`/lessons/${levelCodeFor(next.number)}?scenario=unlocked`} className="lnav-next">
            Перейти к уровню {next.number} «{next.title}»
            <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>

      {next && !lessonComplete && (
        <p className="lnav-gate">
          Уровень {next.number} «{next.title}» откроется после того, как уровень{" "}
          {lesson.level.number} будет завершён: просмотр от{" "}
          {lesson.completionRule.unlockWatchPercent}% и все вопросы проверки.
        </p>
      )}
    </section>
  );
}
