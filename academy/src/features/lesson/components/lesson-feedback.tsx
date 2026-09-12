"use client";

import { forwardRef } from "react";

/**
 * Post-submit explanation (Phase D2B).
 *
 * Educational, never punitive: no "провал", no loss, no penalty, no score, no
 * timer, no comparison with other users. An incorrect answer explains the idea
 * WITHOUT naming the correct option — the question stays open for a calm retry.
 *
 * Receives focus after submit so keyboard and screen-reader users land on the
 * explanation rather than being left where the button used to be.
 */
export const LessonFeedback = forwardRef<
  HTMLDivElement,
  { correct: boolean; text: string }
>(function LessonFeedback({ correct, text }, ref) {
  return (
    <div className={`lfb ${correct ? "ok" : "no"}`} ref={ref} tabIndex={-1}>
      <p className="lfb-head">
        <span className="lfb-glyph" aria-hidden="true">
          {correct ? "✓" : "↻"}
        </span>
        {correct ? "Верно" : "Пока не тот ответ"}
      </p>
      <p className="lfb-text">{text}</p>
      {!correct && <p className="lfb-calm">Ответ можно дать снова — ничего не теряется.</p>}
    </div>
  );
});
