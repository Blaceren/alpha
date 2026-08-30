"use client";

/**
 * L2 server-graded assessment (Client Component).
 *
 * Renders the answer-free questions returned by the Backend, submits stable
 * question/option identifiers, and derives EVERY pass/completion decision from
 * the Backend response. It never computes a score, never writes completion, and
 * never stores pass/unlock/answers as local authority. On a server-confirmed
 * pass it refetches the server-authoritative curriculum via `router.refresh()`.
 */
import Link from "next/link";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { useRouter } from "next/navigation";
import { newRequestId, startAssessment, submitAssessment } from "@/lib/assessment/assessment-client";
import {
  allAnswered,
  initialState,
  reducer,
  type AssessmentState,
} from "@/features/assessment/assessment-machine";
import "@/features/assessment/assessment.css";

export type LevelAssessmentProps = {
  stableCode: string;
  locale: string;
  /** From server summary: the level is already completed (canonical revisit). */
  alreadyCompleted: boolean;
  /** From server navigation: next level code once it is route-accessible, else null. */
  nextLevelCode: string | null;
};

function scoreLine(state: AssessmentState): string {
  const r = state.result;
  if (!r) return "";
  return `Верно ${r.correctCount} из ${r.totalQuestions}`;
}

export function LevelAssessment({ stableCode, locale, alreadyCompleted, nextLevelCode }: LevelAssessmentProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, alreadyCompleted, initialState);
  const inFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);

  // Start (or resume) the attempt whenever we enter the loading phase
  // (initial mount and immediate retry). Aborts on unmount.
  useEffect(() => {
    if (state.phase !== "loading") return;
    const controller = new AbortController();
    let cancelled = false;
    dispatch({ type: "start_pending" });
    startAssessment(stableCode, locale, controller.signal).then((res) => {
      if (cancelled) return;
      if (res.ok) dispatch({ type: "start_ok", data: res.data });
      else dispatch({ type: "start_err", error: res.error });
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase === "loading", stableCode, locale]);

  // Move focus intentionally after a graded result.
  useEffect(() => {
    if (state.phase === "passed" || state.phase === "failed") statusRef.current?.focus();
  }, [state.phase]);

  const onSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (state.phase !== "answering" || !allAnswered(state) || state.attemptId === null) return;
      if (inFlight.current) return; // double-submit guard (single request identity)
      inFlight.current = true;
      const requestId = newRequestId();
      dispatch({ type: "submit_pending", requestId });
      const answers = state.questions.map((q) => {
        const code = state.selections[q.questionKey];
        return { questionKey: q.questionKey, answer: { code: code as string } };
      });
      const res = await submitAssessment(state.attemptId, answers, requestId);
      inFlight.current = false;
      if (res.ok) {
        dispatch({ type: "submit_ok", result: res.data });
        if (res.data.passed) router.refresh(); // re-read server-authoritative state (L3 unlock)
      } else {
        dispatch({ type: "submit_err", error: res.error });
      }
    },
    [state, router],
  );

  const onRetry = useCallback(() => {
    dispatch({ type: "retry" });
    // Return focus to the assessment heading for the fresh attempt.
    requestAnimationFrame(() => headingRef.current?.focus());
  }, []);

  const nextAction = nextLevelCode ? (
    <Link className="asmt__next" href={`/lessons/${encodeURIComponent(nextLevelCode)}`}>
      Перейти к следующему уровню →
    </Link>
  ) : null;

  return (
    <section className="asmt" aria-labelledby="asmt-heading" data-phase={state.phase}>
      <h2 id="asmt-heading" className="asmt__heading" tabIndex={-1} ref={headingRef}>
        Проверка понимания
      </h2>

      {/* Live region: submit / result announcements (not color-only). */}
      <p className="asmt__status" role="status" aria-live="polite" tabIndex={-1} ref={statusRef}>
        {state.phase === "loading" && "Загрузка вопросов…"}
        {state.phase === "submitting" && "Проверяем ответы…"}
        {state.phase === "failed" && `Не пройдено. ${scoreLine(state)}. Можно попробовать ещё раз.`}
        {state.phase === "passed" && `Пройдено. ${scoreLine(state)}. Уровень завершён.`}
        {state.phase === "already_completed" && "Уровень уже завершён."}
      </p>

      {(state.phase === "already_completed" || state.phase === "passed") && (
        <div className="asmt__done">
          <p className="asmt__done-title">✓ Уровень завершён</p>
          {nextAction}
        </div>
      )}

      {state.phase === "flag_disabled" && (
        <p className="asmt__notice">Проверка сейчас недоступна. Материал урока можно читать выше.</p>
      )}
      {state.phase === "stale_content" && (
        <p className="asmt__notice">Материал проверки обновляется. Обновите страницу позже.</p>
      )}
      {state.phase === "error" && (
        <div className="asmt__notice" role="alert">
          <p>Не удалось загрузить проверку. Попробуйте обновить страницу.</p>
          <button type="button" className="asmt__btn" onClick={onRetry}>Повторить</button>
        </div>
      )}

      {(state.phase === "answering" || state.phase === "submitting" || state.phase === "failed") &&
        state.questions.length > 0 && (
          <form className="asmt__form" onSubmit={onSubmit} noValidate>
            {state.phase === "failed" && (
              <div className="asmt__result asmt__result--fail" role="alert">
                <p className="asmt__result-title">✗ Пока не пройдено</p>
                <p className="asmt__result-score">{scoreLine(state)} — нужно ответить верно на все вопросы.</p>
              </div>
            )}

            <ol className="asmt__questions">
              {state.questions.map((q) => {
                const name = `q-${q.questionKey}`;
                return (
                  <li key={q.questionKey} className="asmt__question">
                    <fieldset className="asmt__fieldset">
                      <legend className="asmt__legend">
                        <span className="asmt__qnum">Вопрос {q.questionNumber}</span> {q.prompt}
                      </legend>
                      {q.options.map((opt) => {
                        const id = `${name}-${opt.code}`;
                        return (
                          <div key={opt.code} className="asmt__option">
                            <input
                              type="radio"
                              id={id}
                              name={name}
                              value={opt.code}
                              checked={state.selections[q.questionKey] === opt.code}
                              disabled={state.phase === "submitting"}
                              onChange={() => dispatch({ type: "select", questionKey: q.questionKey, code: opt.code })}
                            />
                            <label htmlFor={id}>{opt.label}</label>
                          </div>
                        );
                      })}
                    </fieldset>
                  </li>
                );
              })}
            </ol>

            {state.phase === "failed" ? (
              <button type="button" className="asmt__btn asmt__btn--primary" onClick={onRetry}>
                Попробовать ещё раз
              </button>
            ) : (
              <button
                type="submit"
                className="asmt__btn asmt__btn--primary"
                disabled={!allAnswered(state) || state.phase === "submitting"}
                aria-disabled={!allAnswered(state) || state.phase === "submitting"}
              >
                {state.phase === "submitting" ? "Проверяем…" : "Проверить ответы"}
              </button>
            )}
          </form>
        )}
    </section>
  );
}
