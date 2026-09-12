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
 * NUMBERING IS PRESENTATION ONLY. Every displayed version is a real sent
 * revision; the ordinal only renames it. Correlation, ordering and every
 * command still use the server's `revisionNumber`, which this file never
 * prints.
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
 * THE VERSIONS THE LEARNER ACTUALLY SENT, in the server's canonical order.
 *
 * `revisionNumber` counts every stored revision including the draft autosaves,
 * so it is a storage key, not a count of anything the learner did. On PREPROD
 * not one of the nine reports has its sent versions numbered from one: they run
 * 2, or 4 and 6, or 2 and 5. Ordering by it is right — it is the canonical
 * order and the only one that survives equal timestamps — but printing it is
 * not: «Версия 4 → Версия 6» tells someone who sent two versions that they sent
 * six.
 *
 * FAIL CLOSED ON A REPEATED KEY. Two entries claiming the same revision number
 * is a history that cannot be numbered without guessing which is which, so
 * nothing is numbered: the arc is withheld rather than invented. The rest of
 * the panel is unaffected.
 */
function sentVersions(submission: ReportSubmission): ReportSubmission["history"] {
  const sent = submission.history
    .filter((revision) => revision.kind !== "draft_autosave")
    .slice()
    .sort((left, right) => left.revisionNumber - right.revisionNumber);
  const keys = new Set(sent.map((revision) => revision.revisionNumber));
  return keys.size === sent.length ? sent : [];
}

/**
 * The number a learner is shown: the position of a sent version among the sent
 * versions, first is one. It is assigned AFTER the canonical sort, so it is a
 * label for a real revision and never an identifier of its own — the review
 * still travels with its revision object, and nothing is ever matched by this
 * ordinal or by a timestamp.
 */
function stagesOf(submission: ReportSubmission): Stage[] {
  const stages: Stage[] = [];
  const sent = sentVersions(submission);

  sent.forEach((revision, index) => {
    const version = index + 1;
    stages.push({
      key: `v${revision.revisionNumber}`,
      label: `Версия ${version} отправлена`,
      at: revision.submittedAt,
    });
    const review = reportReviewEventOf(revision);
    if (!review) return;
    stages.push({
      key: `${review.decision}-${revision.revisionNumber}`,
      label: review.decision === "approved" ? "Работа принята" : "Получен разбор",
      at: review.reviewedAt,
    });
  });
  return stages;
}

/** The displayed number of one stored revision, or null when it is not shown. */
function displayVersionOf(submission: ReportSubmission, revisionNumber: number | null): number | null {
  if (revisionNumber === null) return null;
  const index = sentVersions(submission).findIndex((r) => r.revisionNumber === revisionNumber);
  return index === -1 ? null : index + 1;
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
          {/* THE SAME VERSION MUST HAVE THE SAME NUMBER on the same screen.
              This line named the storage key, so a learner reading it beside an
              arc that says «Версия 1» would see two numbers for one thing. */}
          {displayVersionOf(submission, submission.submittedRevisionNumber) !== null ? (
            <p className="rpt-feedback__which">
              Проверялась версия №{displayVersionOf(submission, submission.submittedRevisionNumber)}.
            </p>
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
