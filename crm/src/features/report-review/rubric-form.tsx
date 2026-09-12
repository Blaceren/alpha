"use client";

import * as React from "react";
import type { Rubric, ReviewScore } from "@/data/contracts/api/report-review";

/**
 * The R1–R7 rubric.
 *
 * Everything is Backend-driven: the criteria, their order, their titles and
 * descriptions, which ones demand a comment, and the scale options. There is no
 * hardcoded criterion list and no scoring truth here — the component renders
 * whatever the reviewer DTO published, in the order it published, and the server
 * re-validates every score regardless.
 *
 * Each criterion is its own `<fieldset>` with a `<legend>`, so a screen-reader
 * user hears which criterion a radio group belongs to. Radios are native inputs:
 * arrow-key navigation within a group and Tab between groups come for free, and
 * the selected state is conveyed by the control itself rather than by colour.
 */

export interface RubricValue {
  scaleCode?: string;
  comment: string;
}

export type RubricValues = Record<string, RubricValue>;

export function emptyRubricValues(rubric: Rubric): RubricValues {
  const values: RubricValues = {};
  for (const criterion of rubric.criteria) values[criterion.code] = { comment: "" };
  return values;
}

export interface RubricValidation {
  /** Criterion codes with no score selected. */
  missingScores: string[];
  /** Criterion codes that demand a comment and have none. */
  missingComments: string[];
  complete: boolean;
}

/**
 * Validate against the Backend's own requirements.
 *
 * A criterion needs a score; a criterion with `commentRequired` also needs a
 * non-empty comment. Both mirror what the backend enforces — this only stops the
 * reviewer from spending a request that can only fail.
 */
export function validateRubric(rubric: Rubric, values: RubricValues): RubricValidation {
  const missingScores: string[] = [];
  const missingComments: string[] = [];

  for (const criterion of rubric.criteria) {
    const entry = values[criterion.code];
    if (!entry?.scaleCode) missingScores.push(criterion.code);
    if (criterion.commentRequired && !(entry?.comment.trim())) missingComments.push(criterion.code);
  }

  return {
    missingScores,
    missingComments,
    complete: missingScores.length === 0 && missingComments.length === 0,
  };
}

/** Build the wire payload. Omits an empty optional comment rather than sending "". */
export function toReviewScores(rubric: Rubric, values: RubricValues): ReviewScore[] {
  return rubric.criteria.map((criterion) => {
    const entry = values[criterion.code];
    const comment = entry?.comment.trim() ?? "";
    return {
      criterionCode: criterion.code,
      scaleCode: entry?.scaleCode ?? "",
      ...(comment ? { comment } : {}),
    };
  });
}

export interface RubricFormProps {
  rubric: Rubric;
  values: RubricValues;
  onChange: (values: RubricValues) => void;
  /** Set once a decision has been attempted, so errors are not shown pre-emptively. */
  showErrors: boolean;
  disabled?: boolean;
}

export function RubricForm({ rubric, values, onChange, showErrors, disabled = false }: RubricFormProps) {
  const validation = validateRubric(rubric, values);

  const setScore = (code: string, scaleCode: string) => {
    onChange({ ...values, [code]: { ...(values[code] ?? { comment: "" }), scaleCode } });
  };
  const setComment = (code: string, comment: string) => {
    onChange({ ...values, [code]: { ...(values[code] ?? { comment: "" }), comment } });
  };

  return (
    <section aria-labelledby="rubric-heading" className="space-y-4">
      <div>
        <h2 id="rubric-heading" className="text-base font-semibold text-text-primary">
          Рубрика оценки
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          {rubric.criteria.length} критериев, версия рубрики №{rubric.versionNumber}. Оценка по каждому
          критерию обязательна.
        </p>
      </div>

      {showErrors && !validation.complete ? (
        <div role="alert" className="rounded border border-danger/40 bg-danger/10 p-3">
          <p className="text-sm font-semibold text-text-primary">Рубрика заполнена не полностью</p>
          <ul className="mt-2 list-inside list-disc text-sm text-text-secondary">
            {validation.missingScores.length > 0 ? (
              <li>
                Не выбрана оценка:{" "}
                {validation.missingScores
                  .map((code) => rubric.criteria.find((c) => c.code === code)?.title ?? code)
                  .join(", ")}
              </li>
            ) : null}
            {validation.missingComments.length > 0 ? (
              <li>
                Требуется комментарий:{" "}
                {validation.missingComments
                  .map((code) => rubric.criteria.find((c) => c.code === code)?.title ?? code)
                  .join(", ")}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <ol className="space-y-3">
        {rubric.criteria.map((criterion, index) => {
          const entry = values[criterion.code] ?? { comment: "" };
          const scoreMissing = showErrors && validation.missingScores.includes(criterion.code);
          const commentMissing = showErrors && validation.missingComments.includes(criterion.code);
          const commentId = `rubric-comment-${criterion.code}`;
          const commentErrorId = `${commentId}-error`;
          const scoreErrorId = `rubric-score-${criterion.code}-error`;

          return (
            <li key={criterion.code}>
              <fieldset
                className={`rounded-lg border bg-surface p-4 ${
                  scoreMissing || commentMissing ? "border-danger/50" : "border-border"
                }`}
              >
                <legend className="px-1 text-sm font-semibold text-text-primary">
                  {/* The stable code is shown alongside the localized title so a
                      mentor and an engineer can talk about the same criterion. */}
                  {index + 1}. {criterion.title}{" "}
                  <span className="font-mono text-2xs font-normal text-text-muted">{criterion.code}</span>
                </legend>
                <p className="mt-1 text-sm text-text-secondary">{criterion.description}</p>

                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                  {rubric.scale.map((option) => {
                    const id = `rubric-${criterion.code}-${option.code}`;
                    return (
                      <span key={option.code} className="inline-flex items-center gap-2">
                        <input
                          id={id}
                          type="radio"
                          name={`rubric-${criterion.code}`}
                          value={option.code}
                          checked={entry.scaleCode === option.code}
                          disabled={disabled}
                          onChange={() => setScore(criterion.code, option.code)}
                          {...(scoreMissing ? { "aria-describedby": scoreErrorId } : {})}
                          className="h-4 w-4 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <label htmlFor={id} className="text-sm text-text-primary">
                          {option.label}
                        </label>
                      </span>
                    );
                  })}
                </div>
                {scoreMissing ? (
                  <p id={scoreErrorId} className="mt-2 text-2xs text-danger">
                    Выберите оценку по этому критерию.
                  </p>
                ) : null}

                <div className="mt-3">
                  <label htmlFor={commentId} className="block text-sm font-medium text-text-primary">
                    Комментарий
                    {criterion.commentRequired ? (
                      <span className="ml-1 text-danger" aria-hidden="true">
                        *
                      </span>
                    ) : null}
                    <span className="ml-1 text-2xs font-normal text-text-muted">
                      {criterion.commentRequired ? "(обязателен)" : "(необязателен)"}
                    </span>
                  </label>
                  <textarea
                    id={commentId}
                    rows={2}
                    value={entry.comment}
                    disabled={disabled}
                    required={criterion.commentRequired}
                    onChange={(event) => setComment(criterion.code, event.target.value)}
                    {...(commentMissing ? { "aria-describedby": commentErrorId, "aria-invalid": true } : {})}
                    className="mt-1 block w-full rounded border border-border bg-background px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  />
                  {commentMissing ? (
                    <p id={commentErrorId} className="mt-1 text-2xs text-danger">
                      Этот критерий требует комментария.
                    </p>
                  ) : null}
                </div>
              </fieldset>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
