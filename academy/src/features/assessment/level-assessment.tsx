"use client";

/**
 * The server-graded lesson test (Client Component).
 *
 * Renders the answer-free questions returned by the Backend, submits stable
 * question/option identifiers, and derives EVERY pass/completion decision from
 * the Backend response. It never computes a score, never writes completion, and
 * never stores pass/unlock/answers as local authority. On a server-confirmed
 * pass it refetches the server-authoritative curriculum via `router.refresh()`.
 *
 * THE РАЗБОР (2026-10-02). The owner's rules for a test are five, and four of
 * them land here:
 *
 *   «При неверном ответе показывать разбор, а не только слово „неверно“.»
 *   «Разбор адресован задаче, а не человеку.»
 *   «Указывать конкретный отрезок видео для пересмотра.»
 *   «Количество попыток не ограничивать.»
 *
 * So a failed attempt stays on the screen exactly as it was answered, each
 * wrongly answered question carries the author's explanation and — when the
 * lesson has a video on this page — a control that plays it from the named
 * second. The explanation is the author's text and is printed as written. The
 * labels around it speak about the question («Разбор»), never about the learner.
 * The fifth rule («неудачные попытки никак не отражать в прогрессе») is the
 * Backend's, and it keeps it.
 *
 * WHAT A FAILED ATTEMPT IS NOT. It is not editable. The Backend has graded and
 * closed it, so its answers are locked and the only way forward is a new
 * attempt.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { newRequestId, startAssessment, submitAssessment } from "@/lib/assessment/assessment-client";
import {
  allAnswered,
  initialState,
  reducer,
  type AssessmentState,
} from "@/features/assessment/assessment-machine";
import type { AssessmentReviewItem } from "@/lib/assessment/types";
import { publishLessonVerdicts, requestLessonRewatch } from "@/features/lesson-media/lesson-playback";
import { formatTimecode } from "@/lib/time/timecode";
import "@/features/assessment/assessment.css";

export type LevelAssessmentProps = {
  stableCode: string;
  locale: string;
  /** From server summary: the level is already completed (canonical revisit). */
  alreadyCompleted: boolean;
  /** From server navigation: next level code once it is route-accessible, else null. */
  nextLevelCode: string | null;
  /**
   * The lesson's video is on this page, so «пересмотреть с …» can be a control
   * rather than a sentence. Server-decided: it is true exactly when the page
   * rendered a player.
   */
  hasLessonVideo?: boolean;
};

function scoreLine(state: AssessmentState): string {
  const r = state.result;
  if (!r) return "";
  return `Верно ${r.correctCount} из ${r.totalQuestions}`;
}

/** Russian plural for «вопрос». Grammar, not a product decision. */
function questionWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "вопрос";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "вопроса";
  return "вопросов";
}

export function LevelAssessment({
  stableCode,
  locale,
  alreadyCompleted,
  nextLevelCode,
  hasLessonVideo = false,
}: LevelAssessmentProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, alreadyCompleted, initialState);
  const inFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  /** The question whose «пересмотреть» found no player to answer it. */
  const [rewatchMissed, setRewatchMissed] = useState<string | null>(null);

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
      // The same key again after a send that did not get through.
      const requestId = state.requestId ?? newRequestId();
      dispatch({ type: "submit_pending", requestId });
      const answers = state.questions.map((q) => {
        const code = state.selections[q.questionKey];
        return { questionKey: q.questionKey, answer: { code: code as string } };
      });
      const res = await submitAssessment(state.attemptId, answers, requestId);
      inFlight.current = false;
      if (res.ok) {
        dispatch({ type: "submit_ok", result: res.data });
        if (res.data.passed) router.refresh(); // re-read server-authoritative state (next level unlock)
      } else {
        dispatch({ type: "submit_err", error: res.error });
      }
    },
    [state, router],
  );

  const onRetry = useCallback(() => {
    setRewatchMissed(null);
    dispatch({ type: "retry" });
    // Return focus to the assessment heading for the fresh attempt.
    requestAnimationFrame(() => headingRef.current?.focus());
  }, []);

  const onRewatch = useCallback((item: AssessmentReviewItem, from: HTMLElement | null) => {
    if (item.rewatchFromSeconds === null) return;
    // False when no player is mounted to take the request (the video failed to
    // render, or was removed since the page was served). Say so beside the
    // control instead of leaving a button that did nothing. The question goes
    // with the request, so a docked player keeps it in view.
    const taken = requestLessonRewatch(item.rewatchFromSeconds, { questionNumber: item.questionNumber, from });
    setRewatchMissed(taken ? null : item.questionKey);
  }, []);

  /**
   * The разбор, by question. Present only on a graded FAILED attempt whose
   * assessment shows explanations; null means the result is the aggregate alone
   * and no question is marked either way.
   */
  const review = useMemo(() => {
    if (state.phase !== "failed" || !state.result || state.result.review === null) return null;
    return new Map(state.result.review.map((item) => [item.questionKey, item]));
  }, [state.phase, state.result]);

  const graded = state.phase === "failed";

  /**
   * THE LESSON LINE HEARS HOW THE ATTEMPT WENT (lesson hi-fi). The verdicts are
   * the ones this component already prints — a question the review lists was
   * answered wrongly, one it does not list rightly, every one right on a pass —
   * and nothing when there is no graded attempt on the screen. Leaving the page
   * takes them away with it.
   */
  useEffect(() => {
    if (state.phase === "passed") {
      publishLessonVerdicts(stableCode, new Map(state.questions.map((q) => [q.questionNumber, "right" as const])));
      return;
    }
    if (state.phase === "failed" && review) {
      publishLessonVerdicts(
        stableCode,
        new Map(state.questions.map((q) => [q.questionNumber, review.has(q.questionKey) ? ("wrong" as const) : ("right" as const)])),
      );
      return;
    }
    if (state.phase === "answering" || state.phase === "loading") publishLessonVerdicts(stableCode, null);
  }, [review, stableCode, state.phase, state.questions]);
  useEffect(() => () => publishLessonVerdicts(stableCode, null), [stableCode]);

  const nextAction = nextLevelCode ? (
    <Link className="asmt__next" href={`/lessons/${encodeURIComponent(nextLevelCode)}`}>
      Перейти к следующему уровню →
    </Link>
  ) : null;

  return (
    <section className="asmt" aria-labelledby="asmt-heading" data-phase={state.phase}>
      <h2 id="asmt-heading" className="asmt__heading" tabIndex={-1} ref={headingRef}>
        Проверка знаний
      </h2>

      {/* Live region: submit / result announcements (not color-only). */}
      <p className="asmt__status" role="status" aria-live="polite" tabIndex={-1} ref={statusRef}>
        {state.phase === "loading" && "Загрузка вопросов…"}
        {state.phase === "answering" &&
          `${state.questions.length} ${questionWord(state.questions.length)}. Нужно ответить верно на все; попытки не ограничены.`}
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
                <p className="asmt__result-score">
                  {scoreLine(state)} — нужно ответить верно на все вопросы.
                  {review
                    ? " Ниже — разбор вопросов с неверным ответом. Попытки не ограничены."
                    : " Попытки не ограничены."}
                </p>
              </div>
            )}

            <ol className="asmt__questions">
              {state.questions.map((q) => {
                const name = `q-${q.questionKey}`;
                const item = review?.get(q.questionKey) ?? null;
                /* A verdict exists only where the Backend gave one: with a
                   review, a question it lists was answered wrongly and one it
                   does not list was answered rightly. Without a review nothing
                   is marked. */
                const verdict = review ? (item ? "wrong" : "right") : null;
                const reviewId = `${name}-review`;
                return (
                  <li key={q.questionKey} className="asmt__question" data-verdict={verdict ?? undefined}>
                    <fieldset
                      className="asmt__fieldset"
                      aria-describedby={item ? reviewId : undefined}
                    >
                      <legend className="asmt__legend">
                        <span className="asmt__qnum">Вопрос {q.questionNumber}</span> {q.prompt}
                        {verdict ? (
                          <span className="asmt__verdict" data-verdict={verdict}>
                            {verdict === "right" ? "Верно" : "Неверно"}
                          </span>
                        ) : null}
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
                              disabled={state.phase === "submitting" || graded}
                              onChange={() => dispatch({ type: "select", questionKey: q.questionKey, code: opt.code })}
                            />
                            <label htmlFor={id}>{opt.label}</label>
                          </div>
                        );
                      })}
                    </fieldset>

                    {item ? (
                      <div className="asmt__review" id={reviewId} data-question={q.questionKey}>
                        <p className="asmt__review-label">Разбор</p>
                        {item.explanation ? (
                          <p className="asmt__review-text">{item.explanation}</p>
                        ) : (
                          <p className="asmt__review-text">
                            На этот вопрос дан неверный ответ.
                          </p>
                        )}
                        {item.rewatchFromSeconds !== null ? (
                          hasLessonVideo ? (
                            <>
                              <button
                                type="button"
                                className="asmt__rewatch"
                                onClick={(event) => onRewatch(item, event.currentTarget.closest("li"))}
                              >
                                Пересмотреть с {formatTimecode(item.rewatchFromSeconds)}
                              </button>
                              {rewatchMissed === q.questionKey ? (
                                <p className="asmt__rewatch-note" role="status">
                                  Видео урока сейчас недоступно на странице. Нужный отрезок начинается
                                  с {formatTimecode(item.rewatchFromSeconds)}.
                                </p>
                              ) : null}
                            </>
                          ) : (
                            <p className="asmt__rewatch-note">
                              Пересмотрите отрезок урока с {formatTimecode(item.rewatchFromSeconds)}.
                            </p>
                          )
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>

            {state.phase === "answering" && state.error ? (
              <p className="asmt__notice asmt__notice--send" role="alert">
                Ответы не отправились. Они на месте — нажмите «Проверить ответы» ещё раз.
              </p>
            ) : null}

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
