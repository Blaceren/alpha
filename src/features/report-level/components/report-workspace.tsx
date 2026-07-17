"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { getModuleForLevel } from "@/data/curriculum/fixture";
import { getPathProgress, type PathScenario } from "@/features/path/model/path-state";
import { useSessionProgress } from "@/features/lessons-library/hooks/use-session-progress";
import type { ReportDefinition } from "@/features/report-level/model/report";
import {
  isEntryFilled,
  withEntryField,
  withSubmitted,
  withSummary,
} from "@/features/report-level/model/report-draft";
import { deriveReportExperience } from "@/features/report-level/model/report-experience";
import {
  SAVE_STATE_LABEL,
  useReportDraft,
} from "@/features/report-level/hooks/use-report-draft";
import { ReportCollapsedRow, ReportOpenEntry } from "@/features/report-level/components/report-entry";
import { ReportBeforeSubmit } from "@/features/report-level/components/report-before-submit";
import { ReportSubmitDialog } from "@/features/report-level/components/report-submit-dialog";

/**
 * Report workspace (Phase D3-B) — the chosen art direction, Concept B
 * «Evidence Ledger», with the one compact block carried over from Concept C
 * (DD-271). Concept A's document composition and Concept C's full right-hand
 * plane were both rejected.
 *
 * The dominant object is the ledger: five evidence entries, matching the five
 * demo trades the curriculum artifact asks for. The count is not a layout choice
 * — it comes from the course.
 *
 * ONE DOM serves both viewports. Desktop shows the whole ledger with one row
 * expanded; mobile hides the collapsed rows in CSS and works one entry at a time
 * with its own prev/next control. Hidden rows are `display: none`, so they are
 * not focusable and no duplicate controls exist across breakpoints.
 *
 * This component renders a MODEL. It computes no progression rule of its own:
 * lifecycle, readiness, and whether the next level is locked all come from
 * `report-experience.ts`.
 */
export function ReportWorkspace({
  definition,
  scenario = "active",
}: {
  definition: ReportDefinition;
  /**
   * Which shared progress marker to read. The KEY crosses the server/client
   * boundary, not the marker object — the PathWorkspace / library precedent
   * (DD-263), which keeps instrumentation this page never renders out of the
   * payload.
   */
  scenario?: PathScenario;
}) {
  const marker = getPathProgress(scenario);
  const session = useSessionProgress();
  const { draft, saveState, update, flush } = useReportDraft(definition);

  const experience = useMemo(
    () => deriveReportExperience({ definition, draft, marker, session }),
    [definition, draft, marker, session],
  );

  const [openOrdinal, setOpenOrdinal] = useState(1);
  const [confirming, setConfirming] = useState(false);

  const level = definition.level;
  const mod = getModuleForLevel(level.number);
  const editable = experience.editable;

  const onFieldChange = useCallback(
    (ordinal: number, key: "when" | "decided" | "noticed", value: string) => {
      update(withEntryField(draft, ordinal, key, value));
    },
    [draft, update],
  );

  const onSummaryChange = useCallback(
    (value: string) => {
      update(withSummary(draft, value));
    },
    [draft, update],
  );

  const onConfirmSubmit = useCallback(() => {
    // The clock is injected here, at the edge — the model stays deterministic.
    flush(withSubmitted(draft, new Date().toISOString()));
    setConfirming(false);
  }, [draft, flush]);

  const total = definition.entryCount;
  const isPending = experience.mode === "pending";
  const isArchive = experience.mode === "archive";

  const goPrev = useCallback(() => setOpenOrdinal((o) => Math.max(1, o - 1)), []);
  const goNext = useCallback(() => setOpenOrdinal((o) => Math.min(total, o + 1)), [total]);

  return (
    <div className="rl-page">
      <header className="rl-head">
        <Link className="rl-back" href="/lessons">
          <span aria-hidden="true">←</span> Уроки
          <span className="rl-back-sep" aria-hidden="true">
            ·
          </span>
          <span className="rl-crumb">
            Модуль {String(mod.index).padStart(2, "0")} · {mod.title}
          </span>
        </Link>

        <div className="rl-id">
          <span className="rl-num mono" aria-hidden="true">
            {String(level.number).padStart(2, "0")}
          </span>
          <h1 className="rl-h1">{level.title}</h1>
          <span className="rl-kind">Отчёт</span>
        </div>

        <div className="rl-meta">
          <p className="rl-req">
            <span className="rl-req-k">Требуется:</span> <b>{level.artifact}</b>
          </p>
          <p className="rl-proto">{definition.editorialNote} — поля ниже prototype-only</p>
        </div>
      </header>

      {/* Status band: one truth at a time. Before submit it is the local save
          state; after submit it is the review status. */}
      {isPending ? (
        <div className="rl-band is-pending">
          <span className="rl-status">На проверке</span>
          <div className="rl-band-txt">
            <p className="rl-wait">Обычно проверка занимает до одного дня.</p>
            <p className="rl-truth">
              Отчёт отмечен как отправленный только в этом браузере. Серверная проверка пока не
              подключена.
            </p>
          </div>
        </div>
      ) : (
        <div className="rl-band">
          {/* Polite: a save state must never interrupt what the user is typing. */}
          <p className="rl-save" role="status" aria-live="polite">
            <span className={`rl-save-dot is-${saveState}`} aria-hidden="true" />
            <span>
              <b>{SAVE_STATE_LABEL[saveState]}</b>{" "}
              {saveState === "unavailable"
                ? "Черновик не сохранится после закрытия вкладки — этот браузер не даёт локально сохранять."
                : "Синхронизация с сервером пока не подключена."}
            </span>
          </p>
        </div>
      )}

      {isArchive && (
        <p className="rl-archive">
          Уровень {level.number} уже пройден в текущем профиле. Здесь показано только то, что
          сохранено в этом браузере, — отчёт можно перечитать, но не изменить.
        </p>
      )}

      {/* Readiness lives in exactly ONE element, on both viewports. The dots are a
          mobile-only decorative echo of the collapsed rows the ledger hides there;
          the sentence beside them is the fact. */}
      <div className="rl-progress">
        <span className="rl-strip-dots" aria-hidden="true">
          {draft.entries.map((entry) => (
            <span
              key={entry.id}
              className={`rl-sd${isEntryFilled(entry) ? " is-filled" : ""}${
                entry.ordinal === openOrdinal ? " is-open" : ""
              }`}
            />
          ))}
        </span>
        <p className="rl-count">{experience.readinessLabel}</p>
      </div>

      <ol className="rl-ledger" aria-label={`Журнал наблюдений — ${total} demo-сделок`}>
        {draft.entries.map((entry) => {
          const panelId = `rl-panel-${entry.ordinal}`;
          const isOpen = entry.ordinal === openOrdinal;
          return (
            <li key={entry.id} className={isOpen ? "is-open" : "is-collapsed"}>
              {isOpen ? (
                <ReportOpenEntry
                  entry={entry}
                  panelId={panelId}
                  editable={editable}
                  onChange={(key, value) => onFieldChange(entry.ordinal, key, value)}
                />
              ) : (
                <ReportCollapsedRow
                  entry={entry}
                  panelId={panelId}
                  onOpen={() => setOpenOrdinal(entry.ordinal)}
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* Mobile only (CSS): sequential movement between entries — the mobile idea
          of this direction is one entry at a time, like one question at a time. */}
      <nav className="rl-steps" aria-label="Переход между записями">
        <button
          type="button"
          onClick={goPrev}
          disabled={openOrdinal === 1}
          aria-label={`Предыдущая запись — запись ${Math.max(1, openOrdinal - 1)}`}
        >
          <span aria-hidden="true">← Запись {Math.max(1, openOrdinal - 1)}</span>
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={openOrdinal === total}
          aria-label={`Следующая запись — запись ${Math.min(total, openOrdinal + 1)}`}
        >
          <span aria-hidden="true">Запись {Math.min(total, openOrdinal + 1)} →</span>
        </button>
      </nav>

      {/* The closing area. On desktop the agreement sits BESIDE the reflection
          rather than under it: stacked, it pushed the one primary action below
          the fold exactly when it became enabled. */}
      <div className="rl-close">
      {/* Reflection: a different material, because it is not evidence. */}
      <section className="rl-refl" aria-labelledby="rl-refl-h">
        <div className="rl-refl-head">
          <h2 className="rl-refl-h" id="rl-refl-h">
            {definition.summaryLabel}
          </h2>
          <span className="rl-refl-s">одно на весь отчёт</span>
          <span className="rl-proto">prototype-only</span>
        </div>
        {/* Named by the heading rather than by a second, visually hidden copy of
            the same words — one owner of the label, no duplication. */}
        <textarea
          id="rl-summary"
          className="rl-w"
          aria-labelledby="rl-refl-h"
          rows={3}
          value={draft.summary}
          placeholder={editable ? definition.summaryPlaceholder : undefined}
          readOnly={!editable}
          onChange={(event) => onSummaryChange(event.target.value)}
        />
      </section>

        {editable && <ReportBeforeSubmit experience={experience} saveState={saveState} />}
      </div>

      {isPending ? (
        <div className="rl-end">
          <div className="rl-end-txt">
            {experience.blockedNote && <p className="rl-blocked">{experience.blockedNote}</p>}
            <p className="rl-blocked-sub">Всё, что уже открыто, остаётся доступным.</p>
          </div>
          <div className="rl-exits">
            <Link className="rl-exit" href="/lessons">
              <span aria-hidden="true">←</span> К списку уроков
            </Link>
            <Link className="rl-exit" href="/path">
              Посмотреть Путь
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="rl-end">
            <div className="rl-end-txt">
              {experience.remainingLabel ? (
                <p className="rl-left">{experience.remainingLabel}</p>
              ) : (
                <p className="rl-left is-ready">{experience.readyLabel}</p>
              )}
              {experience.blockedNote && <p className="rl-blocked">{experience.blockedNote}</p>}
            </div>
            {editable && (
              <button
                type="button"
                className="rl-btn"
                disabled={!experience.canSubmit}
                onClick={() => setConfirming(true)}
              >
                Отправить на проверку
              </button>
            )}
          </div>
        </>
      )}

      {confirming && (
        <ReportSubmitDialog
          experience={experience}
          onCancel={() => setConfirming(false)}
          onConfirm={onConfirmSubmit}
        />
      )}
    </div>
  );
}
