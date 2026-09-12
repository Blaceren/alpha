import { getNextCheckpoint } from "@/data/curriculum/fixture";
import type { LessonExperience } from "@/features/lesson/model/lesson-state-machine";

/**
 * Completion (Phase D2B).
 *
 * Restrained on purpose: a lesson finished is a step taken, not a prize won.
 * No confetti, no celebration overlay, no badge, no score, no invented XP —
 * the canonical instrumentation (2 480 XP) is untouched because no approved rule
 * defines a lesson XP reward yet.
 *
 * It also does not lie about persistence: there is no backend, so it says the
 * sequence holds in this session rather than claiming anything was saved.
 */
export function LessonCompletion({ experience }: { experience: LessonExperience }) {
  const { lesson } = experience;
  const checkpoint = getNextCheckpoint(lesson.level.number);

  return (
    <section className="lcp stage" aria-labelledby="completion-heading">
      <span className="stage-node done" aria-hidden="true" />
      <h2 id="completion-heading">
        <span className="lcp-glyph" aria-hidden="true">
          ✓
        </span>
        Урок завершён
      </h2>

      <p className="lcp-sub">
        Уровень {lesson.level.number} «{lesson.level.title}» выполнен полностью.
      </p>

      <ul className="lcp-reqs">
        {lesson.requirements.map((r) => (
          <li key={r.id}>
            <span className="lcp-check" aria-hidden="true">
              ✓
            </span>
            <span>{r.label}</span>
            <span className="lcp-rstate">выполнено</span>
          </li>
        ))}
      </ul>

      <p className="lcp-ahead">
        Впереди — контрольная точка · Уровень {checkpoint.level}. До неё остаётся уровень{" "}
        {checkpoint.level - 1}; её условие показывается на Пути.
      </p>

      <p className="lcp-honest">
        Отметка хранится только в текущей сессии браузера — сервер прогресса ещё не подключён.
      </p>
    </section>
  );
}
