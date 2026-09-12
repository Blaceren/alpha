"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ReportExperience } from "@/features/report-level/model/report-experience";

/**
 * Submit / resubmit confirmation (Phase D3-B; resubmit variant in D3-C).
 *
 * Why a confirmation at all: marking the report submitted locks editing in this
 * prototype — there is no verdict the user can trigger to get it back. The
 * dialog therefore states the things the user is actually agreeing to,
 * including the two that are easy to get wrong: nothing is synced, and no one
 * is going to approve it here.
 *
 * The primary action is never «Отправить наставнику» — that would be a lie
 * (DD-266). The resubmit variant says «Отправить повторно»: the same honest
 * local mark, one more time.
 *
 * Hand-rolled rather than <dialog>: `showModal()` is unevenly implemented across
 * the jsdom/browser matrix this project tests on, and a focus trap we own is
 * testable everywhere. Semantics are the same — role="dialog", aria-modal, focus
 * moved in and restored on close, Escape closes.
 */
export function ReportSubmitDialog({
  experience,
  variant = "submit",
  onCancel,
  onConfirm,
}: {
  experience: ReportExperience;
  /** "submit" — first submit from draft; "resubmit" — after «Нужна доработка». */
  variant?: "submit" | "resubmit";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<Element | null>(null);

  // Remember what had focus, and give it back on unmount — an interruption must
  // not cost the user their place in the ledger.
  useEffect(() => {
    restoreRef.current = document.activeElement;
    confirmRef.current?.focus();
    return () => {
      if (restoreRef.current instanceof HTMLElement) restoreRef.current.focus();
    };
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;

      // Focus trap: keep Tab inside the dialog while it is open.
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>("button");
      if (!focusables || focusables.length === 0) return;
      const first = focusables.item(0);
      const last = focusables.item(focusables.length - 1);
      if (!first || !last) return;
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onCancel],
  );

  const isResubmit = variant === "resubmit";

  // The blocked-level sentence stays DERIVED (DD-272): it appears only when the
  // resolver actually says the next level is locked, and the resubmit variant
  // phrases the same fact as what happens next — closed until the review result.
  const resubmitBlockedNote =
    isResubmit && experience.nextLevelLocked && experience.nextLevelTitle
      ? `Уровень ${experience.nextLevelNumber} «${experience.nextLevelTitle}» останется закрыт до результата проверки.`
      : null;

  return (
    <div className="rl-scrim" onKeyDown={onKeyDown}>
      {/* The scrim closes on click, but is not a control: keyboard users get
          Escape and the trap, so no focusable duplicate is introduced. */}
      <div className="rl-scrim-hit" onClick={onCancel} aria-hidden="true" />
      <div
        className="rl-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rl-dialog-h"
        aria-describedby="rl-dialog-d"
        ref={panelRef}
      >
        <h2 className="rl-dialog-h" id="rl-dialog-h">
          {isResubmit ? "Отправить отчёт на проверку повторно?" : "Отметить отчёт как отправленный?"}
        </h2>

        <div className="rl-dialog-d" id="rl-dialog-d">
          {isResubmit ? (
            <ul>
              <li>Редактирование снова будет заблокировано в этом прототипе.</li>
              <li>Отметка хранится только в этом браузере — серверная проверка пока не подключена.</li>
              {resubmitBlockedNote && <li>{resubmitBlockedNote}</li>}
              <li>Автоматического одобрения нет: проверка наставником в этом прототипе не подключена.</li>
            </ul>
          ) : (
            <ul>
              <li>После этого редактирование будет заблокировано в этом прототипе.</li>
              <li>Отчёт отмечается отправленным только в этом браузере — серверная синхронизация отсутствует.</li>
              {experience.blockedNote && <li>{experience.blockedNote}</li>}
              <li>Автоматического одобрения нет: проверка наставником в этом прототипе не подключена.</li>
            </ul>
          )}
        </div>

        <div className="rl-dialog-do">
          <button type="button" className="rl-btn-ghost" onClick={onCancel}>
            {isResubmit ? "Продолжить доработку" : "Продолжить редактирование"}
          </button>
          <button type="button" className="rl-btn" onClick={onConfirm} ref={confirmRef}>
            {isResubmit ? "Отправить повторно" : "Отметить как отправленный"}
          </button>
        </div>
      </div>
    </div>
  );
}
