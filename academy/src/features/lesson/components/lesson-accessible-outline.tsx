import type { LessonExperience } from "@/features/lesson/model/lesson-state-machine";

/**
 * Screen-reader summary of the lesson (Phase D2B), mirroring the pattern Путь
 * uses (path-accessible-outline.tsx).
 *
 * The stage is a visual surface; this states the same situation in plain text at
 * the top of <main>: where the step sits, how much is verified as watched, what
 * opens the assessment and what is still required. Nothing here is conveyed by
 * colour, position or the schematic alone.
 */
export function LessonAccessibleOutline({ experience }: { experience: LessonExperience }) {
  const { lesson, watchPercent, testUnlocked, assessmentComplete, question } = experience;
  const threshold = lesson.completionRule.unlockWatchPercent;

  return (
    <nav className="sr-only" aria-label="Состояние урока — текстовая версия">
      <ul>
        <li>
          Уровень {lesson.level.number}, «{lesson.level.title}». Видеоурок идёт первым, проверка
          понимания — под ним.
        </li>
        <li>Подтверждённый просмотр: {Math.floor(watchPercent)} процентов.</li>
        <li>
          {testUnlocked
            ? `Проверка понимания открыта: ${question.total} вопроса, по одному за раз.`
            : `Проверка понимания закрыта: она откроется после ${threshold} процентов просмотра. Смотреть видео полностью не требуется.`}
        </li>
        <li>
          {assessmentComplete
            ? "Все обязательные вопросы отвечены верно — урок завершён."
            : "Урок завершится, когда все обязательные вопросы будут отвечены верно. Неправильный ответ ничего не отнимает."}
        </li>
      </ul>
    </nav>
  );
}
