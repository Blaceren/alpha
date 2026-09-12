import type { LessonDefinition } from "@/features/lesson/model/lesson";

/**
 * The assessment BEFORE the gate opens (Phase D2B).
 *
 * The test is visible in place — it is never hidden and never replaced by a
 * dead disabled button. It states what it is, how many questions it holds, the
 * exact condition that opens it, and how far the verified watch has got, so the
 * 50% rule is understandable rather than merely enforced.
 *
 * It deliberately does NOT reveal any question, option or explanation.
 */
export function LessonAssessmentLocked({
  lesson,
  watchPercent,
}: {
  lesson: LessonDefinition;
  watchPercent: number;
}) {
  const threshold = lesson.completionRule.unlockWatchPercent;
  const remaining = Math.max(0, threshold - Math.floor(watchPercent));

  return (
    <div className="la-locked">
      <p className="la-lockline">
        <span className="la-lockglyph" aria-hidden="true">
          ⃝
        </span>
        Откроется после {threshold}% просмотра
      </p>

      <ul className="la-facts">
        <li>
          Вопросов: <b>{lesson.assessment.questions.length}</b>, по одному за раз
        </li>
        <li>
          Просмотрено: <b>{Math.floor(watchPercent)}%</b>
          {remaining > 0 && <> — осталось {remaining}% до открытия</>}
        </li>
        <li>Смотреть видео полностью не требуется</li>
        <li>Неправильный ответ ничего не отнимает — можно ответить снова</li>
      </ul>

      <p className="la-hint">Вопросы откроются здесь же, под видео.</p>
    </div>
  );
}
