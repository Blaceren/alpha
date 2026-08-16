/**
 * PUBLIC MENTOR FEEDBACK — the learner-visible half of a canonical review.
 *
 * WHAT THIS IS FOR. Seven levels are `mentor_review:mentor_review` and one is
 * `report:report_approval`. On all eight the learner does the work, submits, and
 * then waits for a person. Learner Operations has always carried the reviewer's
 * reply to them — a `LearnerOpsMessage` on the case anchored to their own
 * progress row — and the Academy has never shown it. So a learner who had been
 * written to saw only "ждёт наставника", and had to go looking in Support for a
 * message that was about the level they were standing on.
 *
 * NO NEW MESSAGING EXISTS. This reads the already-accepted Learner Operations
 * learner-visible projection and nothing else. There is no route here that
 * sends, replies, marks read, or names another learner — the Academy is a
 * READER of this surface. Support remains the place a conversation happens.
 *
 * THE PUBLIC / INTERNAL BOUNDARY, AND HOW IT IS ENFORCED HERE.
 * The Backend keeps internal notes in a SEPARATE TABLE (`LearnerOpsNote`) which
 * the learner routes never join, so the payload cannot contain one. This module
 * does not rely on that alone. `toMentorFeedback` is an ALLOWLIST: it builds a
 * new object from four named fields and copies nothing it was not asked for, so
 * a field that should never have been sent — an internal note, a QA score, an
 * escalation, an assignee, a queue, a priority, a reason code, an SLA clock —
 * has no path through it even if a future Backend regression were to include
 * one. The tests assert exactly that, against a deliberately poisoned payload.
 *
 * FEEDBACK IS NOT APPROVAL, AND THIS FILE CANNOT MAKE IT ONE.
 * Nothing here returns a state, a verdict, an XP number or a completion. The
 * only progression fact any caller may use is the one the curriculum provider
 * already gave them. That is the §14 rule expressed as a type: there is no
 * member of `MentorFeedback` that a surface could mistake for a decision.
 */
import type { NormalizedError } from "@/lib/api/errors";

/**
 * One learner-visible reply from a member of staff about a canonical review.
 *
 * `authorName` is the reviewer's display name as the Backend chose to publish
 * it — never an email, never a user id, and never a role. Learner-authored
 * messages are not represented: the learner wrote those, and echoing them back
 * on the level page would turn it into the message inbox §4 forbids.
 */
export type MentorFeedbackMessage = {
  readonly id: string;
  readonly authorName: string;
  readonly body: string;
  readonly createdAt: string;
};

/**
 * The feedback attached to ONE level, as the Academy may show it.
 *
 * `kind` says which canonical review this belongs to, so a surface can name the
 * right person ("наставник" reads correctly for both, but the report and the
 * practical are different workflows and the copy differs).
 */
export type MentorFeedback = {
  readonly kind: "mentor-review" | "report-review";
  readonly levelCode: string;
  readonly messages: readonly MentorFeedbackMessage[];
};

export type MentorFeedbackResult =
  | { ok: true; feedback: MentorFeedback | null }
  | { ok: false; error: NormalizedError };

/* --------------------------------------------------------------- inputs -- */

/**
 * The Learner Operations learner-visible case, as the Academy reads it.
 *
 * Typed as the NARROW subset this module consumes rather than as the Backend's
 * full response. Anything the Backend sends that is not named here is invisible
 * to every function below — which is the boundary, stated as a type.
 */
export type LearnerOpsCaseSummary = {
  readonly id: string;
  readonly type: string;
  readonly level: { readonly levelNumber: number; readonly stableCode: string; readonly title: string } | null;
};

export type LearnerOpsCaseThread = {
  readonly messages: readonly {
    readonly id: string;
    readonly authorKind: string;
    readonly authorName: string;
    readonly body: string;
    readonly createdAt: string;
  }[];
};

/* ---------------------------------------------------------------- rules -- */

/**
 * The two case types that mirror a CANONICAL EDUCATIONAL DECISION.
 *
 * Deliberately not every case type. A `support_request` about a level is a
 * support conversation and belongs in Support; showing it on the level page
 * would mix an operational thread into an educational one and make "наставник
 * ответил" mean two different things.
 */
const REVIEW_CASE_KIND: Readonly<Record<string, MentorFeedback["kind"]>> = {
  mentor_review: "mentor-review",
  report_review: "report-review",
};

/** How many replies one level may show. A level page is not a mailbox. */
export const MAX_FEEDBACK_MESSAGES = 20;

/**
 * The review case anchored to this level, if there is one.
 *
 * Matched on the canonical stable code — never on the subject prose, never on
 * position in the list, never on the case reference. If the Backend sends two
 * (it cannot: both anchors are `@unique`), the first wins deterministically
 * because the list arrives ordered by last activity.
 */
export function findLevelReviewCase(
  cases: readonly LearnerOpsCaseSummary[],
  levelCode: string,
): { caseId: string; kind: MentorFeedback["kind"] } | null {
  for (const row of cases) {
    const kind = REVIEW_CASE_KIND[row.type];
    if (!kind) continue;
    if (row.level?.stableCode !== levelCode) continue;
    return { caseId: row.id, kind };
  }
  return null;
}

/**
 * THE ALLOWLIST. Four fields, copied by name, from staff messages only.
 *
 * Written as an explicit construction rather than a spread-and-delete: a spread
 * carries whatever arrived, and "delete the bad keys" is a list that has to be
 * kept up to date with a system it does not own. This carries whatever it was
 * told to carry, and nothing else can be added by the sender.
 */
export function toMentorFeedback(
  thread: LearnerOpsCaseThread,
  kind: MentorFeedback["kind"],
  levelCode: string,
): MentorFeedback | null {
  const messages: MentorFeedbackMessage[] = [];
  for (const message of thread.messages) {
    // Staff only. A learner's own submission text is not feedback, and the
    // level page must not replay it back at them.
    if (message.authorKind !== "staff") continue;
    if (typeof message.id !== "string" || message.id.length === 0) continue;
    if (typeof message.body !== "string" || message.body.trim().length === 0) continue;
    if (typeof message.createdAt !== "string") continue;
    messages.push({
      id: message.id,
      authorName: typeof message.authorName === "string" && message.authorName.length > 0
        ? message.authorName
        : "Наставник",
      body: message.body,
      createdAt: message.createdAt,
    });
    if (messages.length >= MAX_FEEDBACK_MESSAGES) break;
  }
  if (messages.length === 0) return null;
  return { kind, levelCode, messages };
}
