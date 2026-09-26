/**
 * PUBLIC MENTOR FEEDBACK, on the level it is about.
 *
 * THE ONE RULE THIS COMPONENT EXISTS TO HOLD (§3, §14).
 * A reply from a reviewer is NOT a decision. The two are produced by different
 * people at different times through different systems: a message is written on
 * an operational case, a completion is written by the canonical progression
 * owner. A learner who reads "Наставник ответил" and concludes "уровень пройден"
 * has been misled by the interface, not by the mentor.
 *
 * So this component renders the reply and, in the same breath, the state of the
 * decision — and it takes that state as a prop from the page's canonical read
 * rather than deriving it. It cannot complete anything, cannot show XP, cannot
 * advance anything and has no control of any kind. It is text.
 *
 * WHY IT IS NOT A CARD IN A GRID. §10: the accepted Academy language carries
 * posture in MATERIAL. Feedback belongs to a level that is usually `waiting`,
 * so it wears the cold material — present, legible, and visibly not the lit
 * surface that means "act". When the level is already `completed`, it wears the
 * done material and the sentence changes from "решение ещё не принято" to a
 * plain record of what was said.
 *
 * WHAT IT DOES NOT DO. No reply box, no read receipts, no attachment, no
 * reviewer profile, no thread with the learner's own messages in it. The place
 * a learner writes to ATA is Support, and duplicating that here would create a
 * second inbox with none of Support's guarantees.
 */
import type { MentorFeedback } from "@/lib/learner-ops/mentor-feedback";
import type { AcademyLevelState } from "@/lib/curriculum/progress-state";
import "@/features/mentor-review/mentor-feedback.css";

/**
 * The decision sentence that must accompany every reply.
 *
 * Derived only from the CANONICAL level state the page already read. Note that
 * `pending_review` and `completed` are the only two states a level with review
 * feedback can be in — the others are listed so the function is total and so an
 * unexpected combination says the honest, non-committal thing rather than
 * implying a verdict.
 */
export function decisionNote(state: AcademyLevelState, kind: MentorFeedback["kind"]): string {
  if (state === "completed") {
    return kind === "report-review"
      ? "Отчёт принят. Уровень завершён."
      : "Работа принята наставником. Уровень завершён.";
  }
  if (state === "pending_review") {
    return kind === "report-review"
      ? "Это ответ по отчёту, а не решение. Проверка ещё не завершена — уровень пока не засчитан."
      : "Это ответ наставника, а не решение. Проверка ещё не завершена — уровень пока не засчитан.";
  }
  return "Решение по уровню принимает проверяющий. Ответ выше его не заменяет.";
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  // Fixed locale and explicit fields: this must render identically on the
  // server and in the browser, or React will report a hydration mismatch.
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function MentorFeedbackPanel({
  feedback,
  levelState,
}: {
  feedback: MentorFeedback;
  levelState: AcademyLevelState;
}) {
  // `waiting` while a decision is outstanding, `done` once the canonical owner
  // has decided. Never `act`: there is nothing here to press.
  const posture = levelState === "completed" ? "done" : "waiting";

  return (
    <section
      className="ax-feedback"
      data-posture={posture}
      data-kind={feedback.kind}
      aria-labelledby="ax-feedback-title"
    >
      <h2 id="ax-feedback-title" className="ax-feedback__title">
        {feedback.kind === "report-review" ? "Ответ по отчёту" : "Ответ наставника"}
      </h2>

      <ol className="ax-feedback__list">
        {feedback.messages.map((message) => (
          <li className="ax-feedback__item" key={message.id}>
            <p className="ax-feedback__meta">
              <span className="ax-feedback__who">{message.authorName}</span>
              <time className="ax-feedback__when" dateTime={message.createdAt}>
                {formatWhen(message.createdAt)}
              </time>
            </p>
            {/* Plain text, split on blank lines. The Backend sanitizes this
                content, and it is still never given to dangerouslySetInnerHTML:
                a reviewer writes prose, not markup. */}
            {message.body.split(/\n{2,}/).map((paragraph, index) => (
              <p className="ax-feedback__body" key={index}>
                {paragraph}
              </p>
            ))}
          </li>
        ))}
      </ol>

      {/* The §3 sentence. Rendered as part of the panel, not as a footnote
          somewhere else on the page, because the confusion it prevents happens
          in the seconds between reading the reply and looking for a button. */}
      <p className="ax-feedback__decision" data-state={levelState}>
        {decisionNote(levelState, feedback.kind)}
      </p>
    </section>
  );
}
