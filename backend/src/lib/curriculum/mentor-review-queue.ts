/**
 * G3 — reviewer discovery for mentor-review levels.
 *
 * WHY THIS EXISTS
 * `mentor-review.ts` shipped both halves of the lifecycle — the learner's
 * `in_progress -> pending_review` and the reviewer's `pending_review ->
 * completed` — and said, in as many words, that "reviewer-facing discovery
 * (which levels are waiting) is Phase G". Without it a reviewer had the power to
 * approve and no way to find anything to approve, so the 7 canonical
 * mentor-review levels had no usable staff path at all.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 * It is a READ MODEL DERIVED ENTIRELY FROM DURABLE STATE: the rows whose status
 * is already `pending_review` on a level whose pair is already
 * `mentor_review:mentor_review`. It introduces no table, no column, no claim, no
 * lease, no assignment, no SLA and no new state. Nothing here decides anything —
 * `approveMentorReview` remains the only thing that can change a row, and it
 * re-checks every precondition itself.
 *
 * That distinction is the whole reason this file is safe to add in a runtime
 * correction phase: listing what is already true invents no product behaviour.
 *
 * WHAT A REVIEWER MAY SEE
 * The queue is deliberately narrow — the level, when it was submitted, and
 * enough about the learner to know whose work this is. It carries NO email, no
 * financial field, no Pocket identity, no XP ledger row and no audit history.
 * A reviewer approving a practical exercise does not need any of those, and a
 * queue is exactly the kind of surface that quietly accumulates them.
 *
 * SELF-REVIEW IS EXCLUDED HERE TOO. The domain refuses it, so this is defence in
 * depth rather than the control — but a reviewer should not be shown work they
 * are structurally unable to act on.
 */
import type { LevelDefinitionType, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PRODUCTION_COMPLETION_PAIRS, completionPair } from "./completion-pairs";

/**
 * The one pair this queue lists.
 *
 * Written as the two halves and then CHECKED against the shared vocabulary,
 * rather than split out of it at runtime: `type` is a Prisma enum and a value
 * parsed out of a string cannot be one, so the check is what keeps this file and
 * `mentor-review.ts` from ever disagreeing about which pair is being listed.
 */
const MENTOR_REVIEW_TYPE: LevelDefinitionType = "mentor_review";
const MENTOR_REVIEW_METHOD = "mentor_review";

/* A compile-time-adjacent guard: if the shared vocabulary ever renames this
   pair, this module stops matching anything and the assertion below says so. */
if (
  !PRODUCTION_COMPLETION_PAIRS.mentor_completion.includes(
    completionPair(MENTOR_REVIEW_TYPE, MENTOR_REVIEW_METHOD) as never,
  )
) {
  throw new Error("mentor-review queue pair no longer matches PRODUCTION_COMPLETION_PAIRS");
}

export const MENTOR_REVIEW_QUEUE_DEFAULT_LIMIT = 25;
export const MENTOR_REVIEW_QUEUE_MAX_LIMIT = 50;

/**
 * One waiting review, as a reviewer is allowed to see it.
 *
 * `progressId` is the identity the approve command takes. It is not enumerable
 * by a learner: this queue is reachable only by an active admin or mentor.
 */
export type MentorReviewQueueItem = {
  progressId: number;
  levelNumber: number;
  stableCode: string;
  levelTitle: string;
  /** The canonical reward, so a reviewer knows what approval grants. */
  xpReward: number;
  learnerUserId: number;
  /** Display name only. Never an email. */
  learnerName: string | null;
  /** When the learner submitted it, as an ISO string. */
  requestedAt: string | null;
  curriculumCode: string;
  curriculumVersionNumber: number;
  /**
   * LO-REVIEW-WORKITEM-UNREACHABLE-1 §15 — the operational half of the same
   * work. A pointer for navigation and ownership, never authority: approval is
   * the canonical command, and nothing read from here can change one.
   */
  operationalWorkItem: {
    caseId: string;
    reference: string;
    status: string;
    assignedStaffDisplayName: string | null;
  } | null;
};

export type MentorReviewQueueResult = {
  items: MentorReviewQueueItem[];
  /** The next `progressId` cursor, or null when the queue is exhausted. */
  nextCursor: number | null;
};

export type ListMentorReviewQueueInput = {
  /** From the session. Used only to exclude the reviewer's own work. */
  reviewerUserId: number;
  limit?: number;
  /** Exclusive: return rows with `progressId` strictly greater than this. */
  cursor?: number;
  db?: PrismaClient;
};

/**
 * List the mentor-review levels currently awaiting a reviewer.
 *
 * Ordered by `progressId` ascending — oldest submission first, and a stable,
 * gapless cursor. Deliberately NOT ordered by "waiting longest" on a timestamp:
 * `lastProgressAt` is mutable state, and paginating on a mutable key silently
 * skips or repeats rows while the queue is being worked.
 */
export async function listMentorReviewQueue({
  reviewerUserId,
  limit = MENTOR_REVIEW_QUEUE_DEFAULT_LIMIT,
  cursor,
  db = prisma,
}: ListMentorReviewQueueInput): Promise<MentorReviewQueueResult> {
  const bounded = Math.min(
    Math.max(Number.isSafeInteger(limit) ? limit : MENTOR_REVIEW_QUEUE_DEFAULT_LIMIT, 1),
    MENTOR_REVIEW_QUEUE_MAX_LIMIT,
  );

  const rows = await db.userLevelProgress.findMany({
    where: {
      status: "pending_review",
      levelDefinition: { type: MENTOR_REVIEW_TYPE, completionMethod: MENTOR_REVIEW_METHOD },
      // Defence in depth: the domain refuses self-review, so never offer it.
      enrollment: { userId: { not: reviewerUserId } },
      ...(cursor !== undefined && Number.isSafeInteger(cursor) ? { id: { gt: cursor } } : {}),
    },
    orderBy: { id: "asc" },
    // One extra row decides whether a next page exists without a second query.
    take: bounded + 1,
    select: {
      id: true,
      lastProgressAt: true,
      levelDefinition: {
        select: { levelNumber: true, stableCode: true, title: true, xpReward: true },
      },
      enrollment: {
        select: {
          userId: true,
          curriculumCode: true,
          user: { select: { name: true } },
          curriculumVersion: { select: { versionNumber: true } },
        },
      },
      // LO-REVIEW-WORKITEM-UNREACHABLE-1 §15 — the operational half, so this
      // specialized surface and the unified Learner Operations queue reconcile
      // to ONE object. The report-review surface already carries this; without
      // it here the two review families would document their boundary
      // differently, which is how two truth sets start.
      learnerOpsCases: {
        select: {
          id: true, reference: true, status: true,
          assignedStaff: { select: { displayName: true } },
        },
      },
    },
  });

  const page = rows.slice(0, bounded);
  const nextCursor = rows.length > bounded ? (page[page.length - 1]?.id ?? null) : null;

  return {
    items: page.map((row) => ({
      progressId: row.id,
      levelNumber: row.levelDefinition.levelNumber,
      stableCode: row.levelDefinition.stableCode,
      levelTitle: row.levelDefinition.title,
      xpReward: row.levelDefinition.xpReward,
      learnerUserId: row.enrollment.userId,
      learnerName: row.enrollment.user?.name ?? null,
      requestedAt: row.lastProgressAt?.toISOString() ?? null,
      curriculumCode: row.enrollment.curriculumCode,
      curriculumVersionNumber: row.enrollment.curriculumVersion.versionNumber,
      // A POINTER, never authority: the educational decision is made by the
      // canonical command on this page, not by anything in the operational case.
      operationalWorkItem: row.learnerOpsCases[0]
        ? {
            caseId: row.learnerOpsCases[0].id,
            reference: row.learnerOpsCases[0].reference,
            status: row.learnerOpsCases[0].status,
            assignedStaffDisplayName: row.learnerOpsCases[0].assignedStaff?.displayName ?? null,
          }
        : null,
    })),
    nextCursor,
  };
}
