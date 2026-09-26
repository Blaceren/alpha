"use client";

import type { AssessmentOption } from "@/features/lesson/model/lesson";

/**
 * One answer option (Phase D2B).
 *
 * A real radio input inside the question's fieldset — arrow keys, grouping and
 * checked state come from the platform, not from re-implemented ARIA.
 *
 * After submit the chosen wrong option is marked with a GLYPH AND WORDS
 * ("не тот ответ"), never colour alone. The correct option is never marked while
 * the question is still open, so a retry stays a real retry.
 */
export function LessonAnswerOption({
  option,
  name,
  checked,
  submitted,
  isSubmittedChoice,
  isCorrectChoice,
  onSelect,
}: {
  option: AssessmentOption;
  name: string;
  checked: boolean;
  submitted: boolean;
  isSubmittedChoice: boolean;
  isCorrectChoice: boolean;
  onSelect: (id: string) => void;
}) {
  const verdict = isSubmittedChoice ? (isCorrectChoice ? "correct" : "wrong") : "";

  return (
    <label className={`lao ${checked ? "sel" : ""} ${verdict}`}>
      <input
        type="radio"
        name={name}
        value={option.id}
        checked={checked}
        disabled={submitted}
        onChange={() => onSelect(option.id)}
      />
      <span className="lao-box" aria-hidden="true" />
      <span className="lao-text">{option.text}</span>
      {verdict && (
        <span className={`lao-verdict ${verdict}`}>
          <span className="lao-vglyph" aria-hidden="true">
            {verdict === "correct" ? "✓" : "✕"}
          </span>
          {verdict === "correct" ? "верный ответ" : "не тот ответ"}
        </span>
      )}
    </label>
  );
}
