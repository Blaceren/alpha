"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getModuleForLevel } from "@/data/curriculum/fixture";
import { getPathProgress, type PathScenario } from "@/features/path/model/path-state";
import { useSessionProgress } from "@/features/lessons-library/hooks/use-session-progress";
import type { ReportDefinition } from "@/features/report-level/model/report";
import { isEntryFilled } from "@/features/report-level/model/report-draft";
import {
  withApproved,
  withEntryFieldV3,
  withResubmittedV3,
  withRevisionRequestedV3,
  withSubmittedV3,
  withSummaryV3,
} from "@/features/report-level/model/report-workspace-v3";
import type { ReportVerdictAdapter, ReviewTarget } from "@/features/report-level/model/report-review";
import {
  PROVISIONAL_REVIEW_COMMENT,
  PROVISIONAL_REVIEW_SECTIONS,
} from "@/features/report-level/data/report-review-fixtures";
import { deriveReportExperience } from "@/features/report-level/model/report-experience";
import {
  SAVE_STATE_LABEL,
  useReportDraft,
} from "@/features/report-level/hooks/use-report-draft";
import { ReportCollapsedRow, ReportOpenEntry } from "@/features/report-level/components/report-entry";
import { ReportBeforeSubmit } from "@/features/report-level/components/report-before-submit";
import { ReportSubmitDialog } from "@/features/report-level/components/report-submit-dialog";

/**
 * Report workspace (Phase D3-B; revision cycle D3-C) — Concept B «Evidence
 * Ledger» (DD-271), extended with the chosen revision direction **B «Revision
 * Pass»**: the reviewer's feedback is an ORDER OF WORK, not a dashboard. From
 * direction A only two elements were taken — the calm general comment above the
 * ledger and the human-readable jump links to the flagged sections. A's margin
 * rail and C's standing review contract were rejected (DD-289).
 *
 * The ledger stays the dominant object in every state. Ordinary entries remain
 * calm and fully accessible during a revision — never dimmed into
 * unavailability, never labelled «без пометок» five times over. Flagged
 * sections carry their state in WORDS («требует внимания · доработка 1 из 2»)
 * plus a cold review edge — blue is the review family; green stays reserved for
 * saving, readiness and the successful action (DD-284).
 *
 * ONE DOM serves both viewports. Desktop shows the whole ledger with one row
 * expanded; mobile hides the collapsed rows in CSS and works one entry at a time
 * with its own prev/next control. Hidden rows are `display: none`, so they are
 * not focusable and no duplicate controls exist across breakpoints.
 *
 * This component renders a MODEL. It computes no progression rule of its own:
 * lifecycle, readiness, the resubmit rule and whether the next level is locked
 * all come from `report-experience.ts` / `report-workspace-v2.ts`.
 */
export function ReportWorkspace({
  definition,
  scenario = "active",
  verdictAdapter = null,
}: {
  definition: ReportDefinition;
  /**
   * Which shared progress marker to read. The KEY crosses the server/client
   * boundary, not the marker object — the PathWorkspace / library precedent
   * (DD-263), which keeps instrumentation this page never renders out of the
   * payload.
   */
  scenario?: PathScenario;
  /**
   * DEVELOPMENT AND TEST verdict adapter (DD-286, DD-298) — the resolved
   * `?verdict=` value, or null. It resolves ONLY to `revision-requested` or
   * `approved` (the resolver fails closed on everything else, including any
   * "auto-approved"/"mentor-approved" alias), applies only under the explicit
   * `report` scenario to a pending report, and writes only the report workspace —
   * never `ata.lesson-progress.v1`. No user link or CTA ever carries it, and no
   * user button produces an approval.
   */
  verdictAdapter?: ReportVerdictAdapter | null;
}) {
  const marker = getPathProgress(scenario);
  const session = useSessionProgress();
  const { draft, saveState, update, flush, applyVerdict } = useReportDraft(definition);

  const experience = useMemo(
    () => deriveReportExperience({ definition, draft, marker, session }),
    [definition, draft, marker, session],
  );

  const [confirming, setConfirming] = useState<null | "submit" | "resubmit">(null);

  const level = definition.level;
  const mod = getModuleForLevel(level.number);
  const editable = experience.editable;

  const isRevision = experience.mode === "revision";
  const isPending = experience.mode === "pending";
  const isArchive = experience.mode === "archive";
  const isApproved = experience.mode === "approved";
  const targets = experience.reviewTargets;

  /* ---------------- dev/test verdict adapters (DD-286, DD-298) ---------------- */

  useEffect(() => {
    // Only under the explicit dev/test marker: under any other marker level 3
    // is not the user's live step and a verdict would be meaningless anyway.
    if (scenario !== "report") return;
    // Both adapters act ONLY on a pending report — never on a draft, a
    // revision-requested, or an already-approved (terminal) one. This makes
    // repeated `?verdict=…` on a settled report a no-op.
    if (draft.status !== "pending-review") return;

    if (verdictAdapter === "revision-requested") {
      // One verdict per iteration: a resubmitted report (pending + review) is not
      // re-verdicted automatically — nothing here is automatic beyond the query
      // the developer explicitly typed.
      if (draft.review !== null) return;
      flush(
        withRevisionRequestedV3(draft, definition, {
          comment: PROVISIONAL_REVIEW_COMMENT,
          sections: PROVISIONAL_REVIEW_SECTIONS,
          // The clock is injected at the edge; stored, never rendered.
          receivedAt: new Date().toISOString(),
        }),
      );
      return;
    }

    if (verdictAdapter === "approved") {
      // Approval is allowed on a pending report WHETHER OR NOT it carries a review
      // (a resubmitted pending-review keeps its last comment as history — the
      // adapter does not require review === null, unlike the revision adapter).
      // `applyVerdict` persists first and advances the UI only on success, so a
      // storage failure leaves the report pending — no fabricated approval.
      applyVerdict(withApproved(draft, new Date().toISOString()));
      return;
    }
  }, [verdictAdapter, scenario, draft, definition, flush, applyVerdict]);

  /* ---------------- the revision pass (D3-C) ---------------- */

  // How far the pass has been walked: index+1 of the furthest VISITED target.
  // The first flagged section is current from the start (it is auto-opened),
  // so the pass begins at 1, in words — never a percentage (DD-274).
  const [passVisited, setPassVisited] = useState(1);
  const markTargetVisited = useCallback((index: number) => {
    setPassVisited((seen) => Math.max(seen, index + 1));
  }, []);

  // Which entry is open: the user's explicit choice wins; before any choice the
  // ledger DERIVES it — during a revision the first flagged section is current
  // (it must be found already open, direction B), otherwise entry 1. Derivation
  // instead of an effect: there is no second render and nothing to re-sync.
  const [chosenOrdinal, setChosenOrdinal] = useState<number | null>(null);
  const firstEntryTarget = targets.find((target) => target.kind === "entry-field");
  const openOrdinal =
    chosenOrdinal ?? (isRevision && firstEntryTarget?.ordinal ? firstEntryTarget.ordinal : 1);

  // Jump links: move focus into the flagged field and bring it into a safe
  // visible area. The focus happens in an effect — after the entry actually
  // re-rendered open — never against a stale DOM.
  const pendingFocusRef = useRef<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);

  const jumpToTarget = useCallback(
    (target: ReviewTarget, index: number) => {
      markTargetVisited(index);
      if (target.kind === "entry-field" && target.ordinal !== null) {
        setChosenOrdinal(target.ordinal);
        pendingFocusRef.current = `rl-panel-${target.ordinal}-${target.fieldKey}`;
      } else {
        pendingFocusRef.current = "rl-summary";
      }
      setFocusTick((tick) => tick + 1);
    },
    [markTargetVisited],
  );

  useEffect(() => {
    if (focusTick === 0) return;
    const id = pendingFocusRef.current;
    if (!id) return;
    pendingFocusRef.current = null;
    const el = document.getElementById(id);
    if (el instanceof HTMLElement) {
      el.focus({ preventScroll: true });
      // jsdom has no scrollIntoView; the browser scrolls the field to a safe
      // visible area clear of the bottom navigation.
      el.scrollIntoView?.({ block: "center" });
    }
  }, [focusTick]);

  const targetIndexOfOrdinal = useCallback(
    (ordinal: number) =>
      targets.findIndex((target) => target.kind === "entry-field" && target.ordinal === ordinal),
    [targets],
  );
  const summaryTargetIndex = useMemo(
    () => targets.findIndex((target) => target.kind === "summary"),
    [targets],
  );

  // The pass line, in words. «просмотрены» — the pass is about having LOOKED at
  // the flagged places; readiness to resubmit is a separate, stricter fact.
  const passComplete = targets.length > 0 && passVisited >= targets.length;
  const nextTarget = passComplete ? null : targets[passVisited] ?? null;

  const onFieldChange = useCallback(
    (ordinal: number, key: "when" | "decided" | "noticed", value: string) => {
      update(withEntryFieldV3(draft, ordinal, key, value));
    },
    [draft, update],
  );

  const onSummaryChange = useCallback(
    (value: string) => {
      update(withSummaryV3(draft, value));
    },
    [draft, update],
  );

  const onConfirmSubmit = useCallback(() => {
    // The clock is injected here, at the edge — the model stays deterministic.
    flush(withSubmittedV3(draft, new Date().toISOString()));
    setConfirming(null);
  }, [draft, flush]);

  const onConfirmResubmit = useCallback(() => {
    flush(withResubmittedV3(draft, new Date().toISOString()));
    setConfirming(null);
  }, [draft, flush]);

  const total = definition.entryCount;

  const goPrev = useCallback(
    () => setChosenOrdinal(Math.max(1, openOrdinal - 1)),
    [openOrdinal],
  );
  const goNext = useCallback(
    () => setChosenOrdinal(Math.min(total, openOrdinal + 1)),
    [total, openOrdinal],
  );

  // Opening a flagged entry by ANY means counts as visiting it in the pass.
  const openEntry = useCallback(
    (ordinal: number) => {
      setChosenOrdinal(ordinal);
      const index = targetIndexOfOrdinal(ordinal);
      if (index >= 0) markTargetVisited(index);
    },
    [targetIndexOfOrdinal, markTargetVisited],
  );

  /** Attention wording for a flagged section: state + pass position, in words. */
  const attentionLabelFor = useCallback(
    (index: number) =>
      index < 0 ? null : `требует внимания · доработка ${index + 1} из ${targets.length}`,
    [targets.length],
  );

  const resubmittedTruth = "Исправления отмечены как отправленные только в этом браузере.";

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

      {/* Status band: one truth at a time. Draft → the local save state;
          pending → the review status; revision → the verdict, non-punitively;
          approved → the calm terminal verdict (D3-D). */}
      {isApproved ? (
        <div className="rl-band is-approved">
          <span className="rl-status is-approved">Одобрено</span>
          <div className="rl-band-txt">
            <p className="rl-approved-line">{experience.approvedHeadline}</p>
            <p className="rl-truth">
              Отметка об одобрении хранится только в этом браузере{" "}
              <span className="rl-proto">dev/test · provisional</span>. Это прототип: серверная
              проверка наставником пока не подключена.
            </p>
          </div>
        </div>
      ) : isPending ? (
        <div className="rl-band is-pending">
          <span className="rl-status">На проверке</span>
          <div className="rl-band-txt">
            <p className="rl-wait">Обычно проверка занимает до одного дня.</p>
            <p className="rl-truth">
              {experience.review
                ? `${resubmittedTruth} Серверная проверка пока не подключена.`
                : "Отчёт отмечен как отправленный только в этом браузере. Серверная проверка пока не подключена."}
            </p>
          </div>
        </div>
      ) : isRevision ? (
        <div className="rl-band is-pending">
          <span className="rl-status is-revision">Нужна доработка</span>
          <div className="rl-band-txt">
            <p className="rl-wait">
              <b>Все записи и итоговое наблюдение сохранены</b> — доработка правит ту же работу.
            </p>
            <p className="rl-truth">
              Вердикт записан только в этом браузере. Серверная проверка пока не подключена.
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

      {/* The reviewer's comment — the working order of the revision pass. Calm,
          fully visible, above the ledger. The jump links carry HUMAN labels;
          raw section ids never render (DD-288). */}
      {isRevision && experience.review && (
        <section className="rl-feedback" aria-labelledby="rl-feedback-h">
          <p className="rl-feedback-k" id="rl-feedback-h">
            Комментарий проверки <span className="rl-proto">dev/test · provisional</span>
          </p>
          <p className="rl-feedback-c">«{experience.review.comment}»</p>
          {targets.length > 0 && (
            <p className="rl-feedback-to">
              <span className="rl-feedback-to-k">Требуют внимания:</span>
              {targets.map((target, index) => (
                <button
                  key={target.sectionId}
                  type="button"
                  className="rl-jump"
                  onClick={() => jumpToTarget(target, index)}
                >
                  <span className="rl-jump-arr" aria-hidden="true">
                    →
                  </span>{" "}
                  {target.label}
                </button>
              ))}
            </p>
          )}
        </section>
      )}

      {/* The pass, in words. Calm aria-live: the wording changes exactly when
          the user moves the pass forward, and never counts in percent. */}
      {isRevision && targets.length > 0 && (
        <p className="rl-pass" role="status" aria-live="polite">
          {passComplete ? (
            <>
              <b>
                Доработка {targets.length} из {targets.length}
              </b>{" "}
              · просмотрены — работа снова целиком ваша
            </>
          ) : (
            <>
              <b>
                Доработка {passVisited} из {targets.length}
              </b>{" "}
              {nextTarget && (
                <>
                  ·{" "}
                  <button
                    type="button"
                    className="rl-pass-next"
                    onClick={() => jumpToTarget(nextTarget, passVisited)}
                  >
                    дальше — {nextTarget.label}
                  </button>
                </>
              )}
            </>
          )}
        </p>
      )}

      {/* Readiness lives in exactly ONE element, on both viewports. The dots are a
          mobile-only decorative echo of the collapsed rows the ledger hides there;
          the sentence beside them is the fact. The five dots stay an indicator of
          the report's entries — never of the verdict. */}
      <div className="rl-progress">
        <span className="rl-strip-dots" aria-hidden="true">
          {draft.entries.map((entry) => (
            <span
              key={entry.id}
              className={`rl-sd${isEntryFilled(entry) ? " is-filled" : ""}${
                entry.ordinal === openOrdinal ? " is-open" : ""
              }${targetIndexOfOrdinal(entry.ordinal) >= 0 ? " is-attn" : ""}`}
            />
          ))}
        </span>
        <p className="rl-count">{experience.readinessLabel}</p>
      </div>

      <ol className="rl-ledger" aria-label={`Журнал наблюдений — ${total} demo-сделок`}>
        {draft.entries.map((entry) => {
          const panelId = `rl-panel-${entry.ordinal}`;
          const isOpen = entry.ordinal === openOrdinal;
          const targetIndex = targetIndexOfOrdinal(entry.ordinal);
          const flagged = isRevision && targetIndex >= 0;
          return (
            <li key={entry.id} className={isOpen ? "is-open" : "is-collapsed"}>
              {isOpen ? (
                <ReportOpenEntry
                  entry={entry}
                  panelId={panelId}
                  editable={editable}
                  attentionLabel={flagged ? attentionLabelFor(targetIndex) : null}
                  passHint={
                    flagged && nextTarget && targetIndex === passVisited - 1 ? (
                      <p className="rl-pass-hint">
                        <button
                          type="button"
                          className="rl-pass-next"
                          onClick={() => jumpToTarget(nextTarget, passVisited)}
                        >
                          дальше — {nextTarget.label} <span aria-hidden="true">↓</span>
                        </button>
                      </p>
                    ) : null
                  }
                  onChange={(key, value) => onFieldChange(entry.ordinal, key, value)}
                />
              ) : (
                <ReportCollapsedRow
                  entry={entry}
                  panelId={panelId}
                  flagged={flagged}
                  onOpen={() => openEntry(entry.ordinal)}
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* Mobile only (CSS): sequential movement between entries — the mobile idea
          of this direction is one entry at a time, like one question at a time.
          During a revision the pass has its own movement (the jump links and the
          «дальше» control above); this walk keeps ORDINARY entries reachable. */}
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
      <section
        className={`rl-refl${isRevision && summaryTargetIndex >= 0 ? " is-attn" : ""}`}
        aria-labelledby="rl-refl-h"
      >
        <div className="rl-refl-head">
          {isRevision && summaryTargetIndex >= 0 && (
            <span className="rl-attn-mark" aria-hidden="true" />
          )}
          <h2 className="rl-refl-h" id="rl-refl-h">
            {definition.summaryLabel}
          </h2>
          {isRevision && summaryTargetIndex >= 0 && (
            <span className="rl-attn">{attentionLabelFor(summaryTargetIndex)}</span>
          )}
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
          onFocus={() => {
            if (isRevision && summaryTargetIndex >= 0) markTargetVisited(summaryTargetIndex);
          }}
          onChange={(event) => onSummaryChange(event.target.value)}
        />
      </section>

        {experience.mode === "editing" && (
          <ReportBeforeSubmit experience={experience} saveState={saveState} />
        )}
      </div>

      {/* Pending after a resubmit, or approved with prior feedback: the former
          comment stays visible as quiet history of what was addressed — words
          only, no jump links, no edges, no pass counter, not an active task list
          again. */}
      {(isPending || isApproved) && experience.review && (
        <aside className="rl-feedback is-history" aria-labelledby="rl-feedback-hist-h">
          <p className="rl-feedback-k" id="rl-feedback-hist-h">
            Комментарий последней проверки <span className="rl-proto">dev/test · provisional</span>
          </p>
          <p className="rl-feedback-c">«{experience.review.comment}»</p>
        </aside>
      )}

      {isApproved ? (
        <div className="rl-end is-approved">
          <div className="rl-end-txt">
            {/* The next step — a checkpoint requirement, target only. No balance,
                no remainder, no percentage, no Pocket link, no XP. */}
            {experience.nextStepCheckpoint && (
              <p className="rl-next">
                <span className="rl-next-k">
                  Уровень {experience.nextStepCheckpoint.levelNumber} · Контрольная точка
                </span>
                <span className="rl-next-req">
                  Требуется: {experience.nextStepCheckpoint.requirement}
                </span>
              </p>
            )}
          </div>
          <div className="rl-exits">
            <Link className="rl-btn" href="/path">
              Посмотреть Путь
            </Link>
            <Link className="rl-exit" href="/lessons">
              <span aria-hidden="true">←</span> К списку уроков
            </Link>
          </div>
        </div>
      ) : isPending ? (
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
      ) : isRevision ? (
        <div className="rl-end">
          <div className="rl-end-txt">
            {/* One truth at a time above the CTA: the save state, then what
                stands between the user and the resubmit. */}
            <p className="rl-save" role="status" aria-live="polite">
              <span className={`rl-save-dot is-${saveState}`} aria-hidden="true" />
              <span>{SAVE_STATE_LABEL[saveState]}</span>
            </p>
            {experience.canResubmit ? (
              <p className="rl-left is-ready">{experience.revisionStateLabel}</p>
            ) : (
              <p className="rl-left">{experience.revisionStateLabel}</p>
            )}
            {experience.remainingLabel && <p className="rl-left">{experience.remainingLabel}</p>}
            {experience.blockedNote && <p className="rl-blocked">{experience.blockedNote}</p>}
          </div>
          <button
            type="button"
            className="rl-btn"
            disabled={!experience.canResubmit}
            onClick={() => setConfirming("resubmit")}
          >
            Отправить на проверку повторно
          </button>
        </div>
      ) : (
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
              onClick={() => setConfirming("submit")}
            >
              Отправить на проверку
            </button>
          )}
        </div>
      )}

      {confirming !== null && (
        <ReportSubmitDialog
          experience={experience}
          variant={confirming}
          onCancel={() => setConfirming(null)}
          onConfirm={confirming === "resubmit" ? onConfirmResubmit : onConfirmSubmit}
        />
      )}
    </div>
  );
}
