"use client";

import { forwardRef } from "react";
import { DIRECTION_LABEL, type JournalEntry } from "@/features/tools/model/journal-entry";
import {
  entryNodeLabel,
  formatManualResult,
  formatOccurredAt,
  formatOccurredDate,
  lessonPreview,
  manualResultLine,
  resultTone,
} from "@/features/tools/model/journal-format";

/**
 * A saved journal entry on the spine (Phase D4-B). Collapsed → a compact row:
 * node number, date, instrument, direction, a lesson preview and the secondary
 * result. Expanded → the triptych ПЛАН → ИСПОЛНЕНИЕ → УРОК, with the LESSON
 * column visually dominant and the money result a quiet margin note. Edit is a
 * quiet secondary action.
 */
export const JournalEntryNode = forwardRef<
  HTMLButtonElement,
  {
    entry: JournalEntry;
    expanded: boolean;
    onToggle: () => void;
    onEdit: () => void;
  }
>(function JournalEntryNode({ entry, expanded, onToggle, onEdit }, ref) {
  const panelId = `je-panel-${entry.id}`;
  const tone = resultTone(entry.manualResult);
  const resultText = manualResultLine(entry.manualResult);

  return (
    <li className={`je-node ${expanded ? "is-open" : "is-collapsed"}`}>
      <span className="je-node-dot" aria-hidden="true">
        <span className="je-node-num mono">{entryNodeLabel(entry)}</span>
      </span>

      <div className="je-node-body">
        <button
          type="button"
          ref={ref}
          className="je-node-head"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <span className="je-node-id">
            <span className="je-node-date mono">
              {expanded ? formatOccurredAt(entry.occurredAt) : formatOccurredDate(entry.occurredAt)}
            </span>
            <span className="je-node-sep" aria-hidden="true">
              ·
            </span>
            <span className="je-node-instr">{entry.instrument}</span>
            <span className="je-node-sep" aria-hidden="true">
              ·
            </span>
            <span className="je-node-dir">{DIRECTION_LABEL[entry.direction]}</span>
          </span>
          {!expanded && (
            <span className="je-node-collapsed">
              <span className="je-node-lesson">{lessonPreview(entry.lesson)}</span>
              <span className={`je-node-result tone-${tone}`}>
                <span className="je-result-dot" aria-hidden="true" />
                {entry.manualResult === null ? "без результата" : formatManualResult(entry.manualResult)}
              </span>
            </span>
          )}
          <span className="je-node-toggle" aria-hidden="true">
            {expanded ? "Свернуть" : "Развернуть"}
          </span>
        </button>

        <div id={panelId} className="je-panel" hidden={!expanded}>
          <div className="je-triptych-view">
            <div className="je-col">
              <p className="je-col-k mono">План</p>
              <p className="je-col-v">{entry.plan}</p>
            </div>
            <div className="je-col">
              <p className="je-col-k mono">Исполнение</p>
              <p className="je-col-v">{entry.execution}</p>
            </div>
            <div className="je-col je-col-lesson">
              <p className="je-col-k mono is-lesson">Урок</p>
              <p className="je-col-v is-lesson">{entry.lesson}</p>
            </div>
          </div>

          {entry.setup && (
            <p className="je-setup">
              <span className="je-setup-k">Сетап:</span> {entry.setup}
            </p>
          )}

          <div className="je-panel-foot">
            <p className={`je-result-fact tone-${tone}`}>
              <span className="je-result-dot" aria-hidden="true" />
              {resultText}
            </p>
            <button type="button" className="je-edit" onClick={onEdit}>
              Редактировать
            </button>
          </div>
        </div>
      </div>
    </li>
  );
});
