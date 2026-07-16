"use client";

import { useEffect, useRef } from "react";
import type { AssessmentQuestion } from "@/features/lesson/model/lesson";
import type { AssessmentProgress } from "@/features/lesson/model/assessment";
import { correctOptionId } from "@/features/lesson/model/assessment";
import type { LessonAction } from "@/features/lesson/hooks/use-lesson-experience";
import { LessonAnswerOption } from "@/features/lesson/components/lesson-answer-option";
import { LessonFeedback } from "@/features/lesson/components/lesson-feedback";

/**
 * One question, shown alone (Phase D2B).
 *
 * Exactly one question exists in the DOM at a time — the next one is not
 * rendered, not hidden and not skippable, and «Следующий вопрос» only appears
 * once this one is answered correctly.
 *
 * Structure: form → fieldset → legend, options as radios. Submitting with
 * nothing chosen does not fail silently: it explains what is missing.
 *
 * Focus: after submit → the explanation; after advancing → the new legend.
 */
export function LessonQuestion({
  question,
  progress,
  position,
  total,
  isLast,
  submittedCorrect,
  dispatch,
}: {
  question: AssessmentQuestion;
  progress: AssessmentProgress;
  position: number;
  total: number;
  isLast: boolean;
  submittedCorrect: boolean | null;
  dispatch: (a: LessonAction) => void;
}) {
  const legendRef = useRef<HTMLLegendElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const submitted = progress.submittedOptionId !== null;
  const firstRender = useRef(true);

  // Advancing to a new question moves reading focus to its legend.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    legendRef.current?.focus();
  }, [question.id]);

  // Submitting moves focus onto the explanation that just appeared.
  useEffect(() => {
    if (submitted) feedbackRef.current?.focus();
  }, [submitted, question.id]);

  const correctId = submitted ? correctOptionId(question) : null;

  return (
    <form
      className="lq"
      onSubmit={(e) => {
        e.preventDefault();
        dispatch({ type: "submit" });
      }}
    >
      <fieldset className="lq-set">
        <legend className="lq-legend" tabIndex={-1} ref={legendRef}>
          <span className="lq-count">
            Вопрос {position} из {total}
          </span>
          <span className="lq-prompt">{question.prompt}</span>
        </legend>

        <div className="lq-options">
          {question.options.map((option) => (
            <LessonAnswerOption
              key={option.id}
              option={option}
              name={question.id}
              checked={progress.selectedOptionId === option.id}
              submitted={submitted}
              isSubmittedChoice={progress.submittedOptionId === option.id}
              isCorrectChoice={option.id === correctId}
              onSelect={(id) => dispatch({ type: "select", optionId: id })}
            />
          ))}
        </div>
      </fieldset>

      {progress.submitAttemptedWithoutSelection && (
        <p className="lq-need">Выбери один из вариантов, чтобы ответить.</p>
      )}

      {submitted && submittedCorrect !== null && (
        <LessonFeedback
          ref={feedbackRef}
          correct={submittedCorrect}
          text={submittedCorrect ? question.feedback.correct : question.feedback.incorrect}
        />
      )}

      <div className="lq-actions">
        {!submitted && (
          <button type="submit" className="lq-cta">
            Ответить
          </button>
        )}

        {submitted && submittedCorrect === false && (
          <button type="button" className="lq-cta" onClick={() => dispatch({ type: "retry" })}>
            Ответить снова
          </button>
        )}

        {submitted && submittedCorrect === true && !isLast && (
          <button
            type="button"
            className="lq-cta"
            onClick={() => dispatch({ type: "next-question" })}
          >
            Следующий вопрос
            <span className="lq-go" aria-hidden="true">
              →
            </span>
          </button>
        )}
      </div>
    </form>
  );
}
