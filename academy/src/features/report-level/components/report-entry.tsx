"use client";

import type { ReactNode } from "react";
import { REPORT_ENTRY_FIELDS } from "@/features/report-level/model/report";
import { isEntryFilled, type ReportEntryDraft } from "@/features/report-level/model/report-draft";

/**
 * One evidence entry — collapsed row and open working surface (Phase D3-B;
 * attention marking added in D3-C).
 *
 * A collapsed row is deliberately NOT a card: no border, no radius, no fill, only
 * a hairline and a signal point. What distinguishes the rows is their STATE, not
 * a container (the Evidence Ledger direction, DD-271).
 *
 * State is carried by geometry (filled / hollow point) AND by text — never by
 * colour alone (the DD-232 rule, applied here).
 *
 * D3-C attention marking: a FLAGGED entry says «требует внимания» in words —
 * on the collapsed row in place of the generic fill word, and in the open
 * header with its pass position. Ordinary entries stay exactly as in D3-B; they
 * are never labelled «без пометок» (a repeated non-status would be noise) and
 * never dimmed into unavailability.
 */

function SignalPoint({ filled, open }: { filled: boolean; open: boolean }) {
  return (
    <span
      className={`rl-sig${filled ? " is-filled" : ""}${open ? " is-open" : ""}`}
      aria-hidden="true"
    />
  );
}

/** Short RU summary of a collapsed entry: its own first words, never invented. */
function collapsedSummary(entry: ReportEntryDraft): string {
  if (!isEntryFilled(entry)) return "Запись не заполнена";
  const text = entry.noticed.trim().replace(/\s+/g, " ");
  return text.length > 72 ? `${text.slice(0, 72)}…` : text;
}

export function ReportCollapsedRow({
  entry,
  panelId,
  flagged = false,
  onOpen,
}: {
  entry: ReportEntryDraft;
  panelId: string;
  /** True when the review flagged a field of this entry (D3-C). */
  flagged?: boolean;
  onOpen: () => void;
}) {
  const filled = isEntryFilled(entry);

  // An explicit accessible name, because the visible row carries the same fact
  // three times over (point, status word, action word) for sighted scanning.
  // Reading all of it aloud would be noise, so the name states it once.
  const label = flagged
    ? `Запись ${entry.ordinal}: требует внимания — ${collapsedSummary(entry)}`
    : filled
      ? `Запись ${entry.ordinal}: заполнена — ${collapsedSummary(entry)}`
      : `Запись ${entry.ordinal}: не заполнена`;

  return (
    <button
      type="button"
      className="rl-row"
      aria-expanded={false}
      aria-controls={panelId}
      aria-label={label}
      onClick={onOpen}
    >
      <SignalPoint filled={filled} open={false} />
      <span className="rl-n mono" aria-hidden="true">
        {String(entry.ordinal).padStart(2, "0")}
      </span>
      <span className="rl-sum" aria-hidden="true">
        {collapsedSummary(entry)}
      </span>
      <span className={`rl-state${flagged ? " is-attn" : ""}`} aria-hidden="true">
        {flagged ? "требует внимания" : filled ? "заполнена" : "не заполнена"}
      </span>
      <span className="rl-act" aria-hidden="true">
        {filled ? "Развернуть" : "Открыть"}
      </span>
    </button>
  );
}

export function ReportOpenEntry({
  entry,
  panelId,
  editable,
  attentionLabel = null,
  passHint = null,
  onChange,
}: {
  entry: ReportEntryDraft;
  panelId: string;
  editable: boolean;
  /** e.g. «требует внимания · доработка 1 из 2» — the flagged wording (D3-C). */
  attentionLabel?: string | null;
  /** The in-flow pass movement, e.g. «дальше — Итоговое наблюдение ↓» (D3-C). */
  passHint?: ReactNode;
  onChange: (key: "when" | "decided" | "noticed", value: string) => void;
}) {
  const filled = isEntryFilled(entry);

  return (
    <div className={`rl-open${attentionLabel ? " is-attn" : ""}`}>
      <div className="rl-open-head">
        <SignalPoint filled={filled} open />
        <span className="rl-n mono" aria-hidden="true">
          {String(entry.ordinal).padStart(2, "0")}
        </span>
        <h3 className="rl-open-t" id={`${panelId}-title`}>
          Запись {entry.ordinal}
        </h3>
        {attentionLabel ? (
          <span className="rl-attn">{attentionLabel}</span>
        ) : (
          <span className="rl-state">{filled ? "заполнена" : "не заполнена"}</span>
        )}
        <span className="rl-proto">структура полей — prototype-only</span>
      </div>

      <div className="rl-fields" id={panelId} aria-labelledby={`${panelId}-title`}>
        {REPORT_ENTRY_FIELDS.map((field) => {
          const fieldId = `${panelId}-${field.key}`;
          const value = entry[field.key];

          /**
           * A read-only optional field the user left blank is NOT an input.
           * Rendering an empty bordered box that cannot be typed into invites the
           * user to try, and a control that refuses input is worse than no
           * control. It states the absence calmly instead — muted, never red:
           * skipping optional context is not an error.
           */
          if (!editable && !field.required && value.trim().length === 0) {
            return (
              <div className={`rl-f${field.multiline ? " is-long" : ""}`} key={field.key}>
                <p className="rl-f-k">{field.label}</p>
                <p className="rl-empty">Не заполнено</p>
              </div>
            );
          }

          return (
            <div
              className={`rl-f${field.multiline ? " is-long" : ""}`}
              key={field.key}
            >
              <label htmlFor={fieldId}>
                {field.label}
                {!field.required && <span className="rl-opt"> · необязательно</span>}
              </label>
              {field.multiline ? (
                <textarea
                  id={fieldId}
                  className="rl-ta"
                  value={value}
                  placeholder={editable ? field.placeholder : undefined}
                  readOnly={!editable}
                  rows={3}
                  onChange={(event) => onChange(field.key, event.target.value)}
                />
              ) : (
                <input
                  id={fieldId}
                  className="rl-in"
                  type="text"
                  value={value}
                  placeholder={editable ? field.placeholder : undefined}
                  readOnly={!editable}
                  onChange={(event) => onChange(field.key, event.target.value)}
                />
              )}
            </div>
          );
        })}
      </div>

      {passHint}
    </div>
  );
}
