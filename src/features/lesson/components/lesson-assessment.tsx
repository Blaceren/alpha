"use client";

import { currentQuestion, isSubmittedAnswerCorrect } from "@/features/lesson/model/assessment";
import type { LessonExperience } from "@/features/lesson/model/lesson-state-machine";
import type { LessonAction } from "@/features/lesson/hooks/use-lesson-experience";
import { LessonAssessmentLocked } from "@/features/lesson/components/lesson-assessment-locked";
import { LessonQuestion } from "@/features/lesson/components/lesson-question";

/**
 * «Проверка понимания» — the assessment stage (Phase D2B).
 *
 * Always present in the flow, directly BELOW the video in document order, in
 * every state: locked (visible, explained, contents hidden), ready, one open
 * question, or completed. It is never removed and never becomes a dead button.
 */
export function LessonAssessment({
  experience,
  dispatch,
}: {
  experience: LessonExperience;
  dispatch: (a: LessonAction) => void;
}) {
  const { lesson, session, assessment, testUnlocked, watchPercent, question } = experience;

  return (
    <section className="la stage" aria-labelledby="assessment-heading">
      <span className="stage-node" aria-hidden="true" />
      <div className="la-head">
        <h2 id="assessment-heading">{lesson.assessment.title}</h2>
        {/* The question counter belongs to the legend — this chip states the
            stage only, so the count is not announced twice. */}
        <p className={`la-state ${testUnlocked ? "open" : "shut"}`}>
          {assessment === "locked" && "Закрыта"}
          {assessment === "ready" && "Открыта"}
          {(assessment === "answering" ||
            assessment === "feedback_correct" ||
            assessment === "feedback_incorrect") &&
            "Идёт проверка"}
          {assessment === "completed" && "Пройдена"}
        </p>
      </div>

      {assessment === "locked" && (
        <LessonAssessmentLocked lesson={lesson} watchPercent={watchPercent} />
      )}

      {assessment === "ready" && (
        <div className="la-ready">
          <p className="la-readytext">
            Просмотрено {Math.floor(watchPercent)}% — проверка открыта. {question.total} вопроса
            подряд, по одному за раз. Ошибка ничего не отнимает.
          </p>
          <button
            type="button"
            className="la-cta"
            onClick={() => dispatch({ type: "start-assessment" })}
          >
            Начать проверку
            <span className="la-go" aria-hidden="true">
              →
            </span>
          </button>
        </div>
      )}

      {(assessment === "answering" ||
        assessment === "feedback_correct" ||
        assessment === "feedback_incorrect") && (
        <LessonQuestion
          question={currentQuestion(lesson.assessment, session.assessment)}
          progress={session.assessment}
          position={question.position}
          total={question.total}
          isLast={question.position === question.total}
          submittedCorrect={isSubmittedAnswerCorrect(lesson.assessment, session.assessment)}
          dispatch={dispatch}
        />
      )}

      {assessment === "completed" && (
        <div className="la-done">
          <p className="la-donetext">
            Все {question.total} вопроса разобраны. Ниже — что зачтено по уроку.
          </p>
          <ul className="la-review">
            {lesson.assessment.questions.map((q, i) => (
              <li key={q.id}>
                <span className="la-rnum" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="la-rtext">{q.prompt}</span>
                <span className="la-rok">
                  <span aria-hidden="true">✓</span> отвечен верно
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
