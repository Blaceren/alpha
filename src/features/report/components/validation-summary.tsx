"use client";

/**
 * Error summary. Rendered above the form after a submit attempt with client-side
 * errors, and for a bounded server-validation failure. Each entry focuses its
 * field so keyboard users reach the problem directly. Never shows a stack trace,
 * Prisma path, SQL, raw DTO dump or internal id.
 */
import { useEffect, useRef } from "react";
import type { ReportFieldError } from "@/features/report/report-validation";

export type ValidationSummaryProps = {
  errors: ReportFieldError[];
  /** A bounded, safe server message (e.g. "проверьте поля" / stale conflict). */
  serverMessage?: string | null;
  labelForKey: (stableKey: string) => string;
};

export function ValidationSummary({ errors, serverMessage, labelForKey }: ValidationSummaryProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Move focus to the summary when it appears so the error is announced.
    ref.current?.focus();
  }, []);

  if (errors.length === 0 && !serverMessage) return null;

  return (
    <div className="rpt-summary eng-notice" role="alert" tabIndex={-1} ref={ref} aria-labelledby="rpt-summary-title">
      <p className="rpt-summary__title eng-notice__head" id="rpt-summary-title">
        Проверьте отчёт перед отправкой
      </p>
      {serverMessage ? <p className="rpt-summary__server eng-notice__body">{serverMessage}</p> : null}
      {errors.length > 0 ? (
        <ul className="rpt-summary__list eng-notice__body">
          {errors.map((err) => (
            <li key={err.stableKey}>
              <a
                href={`#rf-${err.stableKey}`}
                onClick={(event) => {
                  event.preventDefault();
                  const el = document.getElementById(`rf-${err.stableKey}`)
                    ?? document.querySelector(`[data-field="${CSS.escape(err.stableKey)}"] input, [data-field="${CSS.escape(err.stableKey)}"] textarea`);
                  if (el instanceof HTMLElement) el.focus();
                }}
              >
                {labelForKey(err.stableKey)}: {err.message}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
