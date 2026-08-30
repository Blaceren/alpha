"use client";

/**
 * Status panel + revision timeline. Renders the current workflow status (never
 * colour-only — always a text label + icon glyph), the mentor's revision-request
 * feedback allowed by the learner DTO, and an immutable, ordered revision
 * history. Exposes no reviewer-private scores, no internal ids, no XP transaction
 * id, and no rubric internals.
 */
import type { ReportSubmission } from "@/lib/report/types";

const KIND_LABEL: Record<ReportSubmission["history"][number]["kind"], string> = {
  draft_autosave: "Черновик",
  initial_submission: "Отправка",
  resubmission: "Повторная отправка",
};

export function ReportStatusPanel({ submission }: { submission: ReportSubmission | null }) {
  if (!submission) return null;

  const submitted = submission.history
    .filter((rev) => rev.kind !== "draft_autosave")
    .sort((a, b) => a.revisionNumber - b.revisionNumber);

  return (
    <aside className="rpt-status" aria-label="Статус отчёта">
      {submission.rejection ? (
        <div className="rpt-feedback eng-fb" role="note">
          <p className="rpt-feedback__title eng-fb__label">
            <span aria-hidden="true">↩︎ </span>Наставник запросил доработку
          </p>
          <p className="rpt-feedback__reason eng-fb__body">
            <span className="rpt-feedback__label">Причина:</span> {submission.rejection.reasonTitle}
          </p>
          {submission.rejection.humanComment ? (
            <p className="rpt-feedback__comment eng-fb__body">{submission.rejection.humanComment}</p>
          ) : null}
          {submission.rejection.correctiveAction ? (
            <p className="rpt-feedback__action eng-fb__body">
              <span className="rpt-feedback__label">Что сделать:</span> {submission.rejection.correctiveAction}
            </p>
          ) : null}
          {submission.submittedRevisionNumber !== null ? (
            <p className="rpt-feedback__which">Проверялась версия №{submission.submittedRevisionNumber}.</p>
          ) : null}
        </div>
      ) : null}

      {submitted.length > 0 ? (
        <div className="rpt-timeline">
          <p className="rpt-timeline__title">История отправок</p>
          <ol className="rpt-timeline__list">
            {submitted.map((rev) => (
              <li key={rev.revisionNumber} className="rpt-timeline__item">
                <span className="rpt-timeline__num">№{rev.revisionNumber}</span>
                <span className="rpt-timeline__kind">{KIND_LABEL[rev.kind]}</span>
                {rev.submittedAt ? (
                  <time className="rpt-timeline__at" dateTime={rev.submittedAt}>
                    {new Date(rev.submittedAt).toLocaleDateString("ru-RU")}
                  </time>
                ) : null}
                {submission.approvedRevisionNumber === rev.revisionNumber ? (
                  <span className="rpt-timeline__badge" data-kind="approved">✓ принята</span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </aside>
  );
}
