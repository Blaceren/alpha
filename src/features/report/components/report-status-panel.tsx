"use client";

/**
 * Status panel + the evidence arc.
 *
 * WHAT THIS SHOWS AND WHY. A report that was accepted on the second try has a
 * story: a version went in, a review came back asking for something, a
 * corrected version went in, and it was accepted. The panel used to be able to
 * show only two of those four — the versions — because the contract carried a
 * single review and dropped it the moment the report was accepted. It now
 * carries the review of each revision, so the arc can be stated in full.
 *
 * THE RESULT DOMINATES, THE STORY IS AVAILABLE. Once the work is accepted the
 * acceptance is the thing on screen; the arc sits under it in a closed
 * `<details>`. While a correction is still outstanding the opposite holds: the
 * request and what to do about it stay open, because that is the task.
 *
 * NOTHING IS RECONSTRUCTED. A version whose review the Backend did not report
 * contributes no review stage. A resubmission is not evidence that a review
 * happened; it is evidence that a resubmission happened.
 *
 * Exposes no reviewer identity, no reviewer-private scores, no internal ids, no
 * rubric internals and none of the learner's own answer text.
 */
import type { ReportSubmission } from "@/lib/report/types";
import { reportReviewEventOf } from "@/lib/report/types";

const KIND_LABEL: Record<ReportSubmission["history"][number]["kind"], string> = {
  draft_autosave: "Черновик",
  initial_submission: "Отправка",
  resubmission: "Повторная отправка",
};

/** One thing that happened, in the order it happened. */
type Stage = { key: string; label: string; at: string | null };

/**
 * THE VERSION NUMBER IS THE SERVER'S, NOT A COUNTER.
 *
 * Draft autosaves take numbers from the same sequence, so a learner's first
 * submitted version is rarely number one — on PREPROD today it is usually two,
 * and later ones are four, five or six. Renumbering the list 1, 2, 3 would read
 * more neatly and would name versions that do not exist; the number shown is
 * the one the server assigned.
 */
function stagesOf(submission: ReportSubmission): Stage[] {
  const stages: Stage[] = [];
  const submitted = submission.history
    .filter((revision) => revision.kind !== "draft_autosave")
    .slice()
    .sort((left, right) => left.revisionNumber - right.revisionNumber);

  for (const revision of submitted) {
    stages.push({
      key: `v${revision.revisionNumber}`,
      label: `Версия ${revision.revisionNumber} отправлена`,
      at: revision.submittedAt,
    });
    const review = reportReviewEventOf(revision);
    if (!review) continue;
    stages.push({
      key: `${review.decision}-${revision.revisionNumber}`,
      label: review.decision === "approved" ? "Работа принята" : "Получен разбор",
      at: review.reviewedAt,
    });
  }
  return stages;
}

/** «1 этап», «2 этапа», «5 этапов» — the summary counts what is inside it. */
function stageWord(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return "этапов";
  if (ones === 1) return "этап";
  if (ones >= 2 && ones <= 4) return "этапа";
  return "этапов";
}

function StageList({ stages }: { stages: Stage[] }) {
  return (
    <ol className="rpt-arc__list">
      {stages.map((stage) => (
        <li key={stage.key} className="rpt-arc__item">
          <span className="rpt-arc__label">{stage.label}</span>
          {stage.at ? (
            <time className="rpt-arc__at" dateTime={stage.at}>
              {new Date(stage.at).toLocaleDateString("ru-RU")}
            </time>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function ReportStatusPanel({ submission }: { submission: ReportSubmission | null }) {
  if (!submission) return null;

  const stages = stagesOf(submission);
  const accepted = submission.status === "approved";

  return (
    <aside className="rpt-status" aria-label="Статус отчёта">
      {accepted ? (
        /* The result, said once and said plainly. The glyph is decorative: the
           state is carried by the words, never by colour alone. */
        <p className="rpt-verdict">
          <span aria-hidden="true">✓ </span>Работа принята
        </p>
      ) : null}

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

      {stages.length === 0 ? null : accepted ? (
        /* Native `details`: keyboard and screen readers get the disclosure for
           free, and the closed content leaves the tab order without a script. */
        <details className="rpt-arc">
          <summary className="rpt-arc__summary">
            История проверки · {stages.length} {stageWord(stages.length)}
          </summary>
          <StageList stages={stages} />
        </details>
      ) : (
        <div className="rpt-arc rpt-arc--open">
          <p className="rpt-arc__title">История проверки</p>
          <StageList stages={stages} />
        </div>
      )}
    </aside>
  );
}

export { KIND_LABEL };
