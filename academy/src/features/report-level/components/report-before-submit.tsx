"use client";

import type { ReportExperience } from "@/features/report-level/model/report-experience";
import {
  SAVE_STATE_LABEL,
  type ReportSaveState,
} from "@/features/report-level/hooks/use-report-draft";

/**
 * «Перед отправкой» — the ONE element carried over from Concept C (DD-271).
 *
 * What was taken: the compact agreement that answers, in the user's own reading
 * order, what is required · what is saved · how ready the work is · what happens
 * after submit.
 *
 * What was deliberately NOT taken: Concept C's full right-hand dashboard plane.
 * The Evidence Ledger is the dominant object of this screen; a standing status
 * panel would compete with it, which was Concept C's own stated main risk. This
 * block therefore sits inline at the end of the work, is capped to roughly a
 * quarter of the working width on desktop, and is never sticky over the bottom
 * navigation on mobile.
 *
 * The blocked-progression line comes from `experience.blockedNote`, which is
 * derived from the availability resolver — it is absent, not false, when the next
 * level is genuinely already open.
 */
export function ReportBeforeSubmit({
  experience,
  saveState,
}: {
  experience: ReportExperience;
  /**
   * The REAL save state. This block used to hardcode «Черновик сохранён в этом
   * браузере», which made it lie the moment a write failed — the one place the
   * user most needs the truth is the agreement they are about to act on.
   */
  saveState: ReportSaveState;
}) {
  const { definition } = experience;

  return (
    <aside className="rl-before" aria-labelledby="rl-before-h">
      <h2 className="rl-before-h" id="rl-before-h">
        Перед отправкой
      </h2>

      <dl className="rl-before-list">
        <div className="rl-before-row">
          <dt>Требуется</dt>
          {/* The editorial note is NOT repeated here — the header already says the
              task structure is provisional, and saying it twice is noise. */}
          <dd>{definition.level.artifact}</dd>
        </div>

        <div className="rl-before-row">
          <dt>Готовность</dt>
          <dd>
            {experience.readinessLabel}
            {experience.remainingLabel && (
              <span className="rl-before-sub">{experience.remainingLabel}</span>
            )}
            {experience.readyLabel && (
              <span className="rl-before-ready">{experience.readyLabel}</span>
            )}
          </dd>
        </div>

        <div className="rl-before-row">
          <dt>Сохранено</dt>
          <dd>{SAVE_STATE_LABEL[saveState]}</dd>
        </div>

        <div className="rl-before-row">
          <dt>После отправки</dt>
          <dd>
            <ul className="rl-before-ul">
              <li>
                отчёт получит статус <b>«На проверке»</b>;
              </li>
              {experience.blockedNote && <li>{experience.blockedNote}</li>}
              <li>серверная проверка пока не подключена;</li>
              <li>редактирование будет заблокировано в этом прототипе.</li>
            </ul>
          </dd>
        </div>
      </dl>
    </aside>
  );
}
