/**
 * A4 — the two-actor lifecycle for `mentor_review:mentor_review`.
 *
 * WHAT WAS MISSING, AND WHY IT WAS TWO THINGS
 * `completion.ts` maps this pair to the `mentor_completion` owner with
 * `initialStatus: "pending_review"`. Nothing could reach that owner, and — less
 * obviously — nothing could put a level into `pending_review` in the first
 * place. The start owner creates progress as `in_progress`, so under product
 * decision R1 all 7 mentor-reviewed practical levels were doubly stuck: no
 * transition in, and no owner reachable out.
 *
 * Both halves are here, and they belong to DIFFERENT actors:
 *
 *   requestMentorReview   learner   in_progress    -> pending_review
 *   approveMentorReview   reviewer  pending_review -> completed
 *
 * `pending_review` IS THE AUTHORIZATION BOUNDARY, and it is enforced by the
 * database rather than by this file: the learner's own transition can only move
 * `in_progress -> pending_review`, and the completion owner will only take over
 * a row that is already `pending_review`. A learner therefore cannot complete
 * their own level even if they reached the approve command, because their
 * command cannot produce the state the completion owner requires, and the
 * approve command refuses a reviewer who owns the enrollment.
 *
 * REVIEWER AUTHORIZATION IS THE SHIPPED ONE
 * `requireTaskReportReviewer` (admin | mentor) — the same model the report
 * review workflow uses. No new role, no new grant table, and no client-supplied
 * role: the actor comes from the session and the role is re-read from the
 * database inside the transaction. There is no "reviewerRole" body field to
 * forge, because there is no such field.
 *
 * SELF-REVIEW IS REFUSED TWICE
 * Once here, comparing the reviewer against the enrollment's owner, and once
 * structurally: an admin or mentor who is also the learner still cannot reach
 * `pending_review` for their own enrollment and then approve it, because the
 * comparison happens before any write.
 *
 * IDEMPOTENCY WITHOUT A NEW TABLE
 * The completion source id is `mentor-review:<UserLevelProgress.id>` —
 * deterministic, derived from durable state rather than from a request. The
 * resulting contract, stated exactly:
 *
 *   * the SAME reviewer approving again replays: `created: false`, the original
 *     completion time, no second XP row, no second unlock, no second audit;
 *   * a DIFFERENT reviewer approving an XP-bearing level already approved gets
 *     `MENTOR_REVIEW_CONFLICT` (409). The XP ledger records the first reviewer
 *     as the award's actor and refuses to answer for an identity it does not
 *     hold — which is the honest answer: somebody else approved this, and
 *     saying "done, by you" would put the wrong name on the work. The level
 *     stays completed exactly once either way;
 *   * on a ZERO-reward level a different reviewer replays instead of
 *     conflicting, because with no XP row there is no durable actor identity to
 *     disagree with. Both answers are safe; only which of the two a second
 *     reviewer sees differs.
 *
 * The approving reviewer's identity is durably recorded by the completion audit
 * event (`CURRICULUM_LEVEL_COMPLETED`, `actorId`), written in the same
 * transaction as the completion.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * A rubric, a score, a rejection reason, a claim/lease, a review queue and a
 * reviewer-visible learner profile. Those are the REPORT workflow, which has
 * its own tables and its own phase. A mentor-review level has no report, so
 * inventing rubric rows for it would fabricate acceptance criteria nobody
 * approved. Reviewer-facing discovery (which levels are waiting) is Phase G.
 */
import type { Prisma, PrismaClient, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { emitMentorReviewSubmittedEvent } from "@/lib/growth/product-events";
import {
  ensureMentorReviewWorkItem,
  reconcileMentorReviewOperationalState,
  resolveOperationalActor,
} from "@/lib/learner-ops/review-work-items";
import {
  completeCurriculumLevelInTransaction,
  isCurriculumLevelCompletionError,
} from "./completion";
import { PRODUCTION_COMPLETION_PAIRS, completionPair } from "./completion-pairs";
import { CURRICULUM_AUDIT_ACTIONS } from "./constants";

/** The one pair this lifecycle governs. */
const MENTOR_REVIEW_PAIRS: ReadonlySet<string> = new Set(
  PRODUCTION_COMPLETION_PAIRS.mentor_completion,
);

/** The shipped reviewer roles. Identical to the report review workflow's. */
const REVIEWER_ROLES: ReadonlySet<UserRole> = new Set<UserRole>(["admin", "mentor"]);

export type MentorReviewErrorCode =
  | "MENTOR_REVIEW_DISABLED"
  | "MENTOR_REVIEW_INPUT_INVALID"
  | "MENTOR_REVIEW_FORBIDDEN"
  | "MENTOR_REVIEW_SELF_REVIEW_FORBIDDEN"
  | "MENTOR_REVIEW_NOT_ENROLLED"
  | "MENTOR_REVIEW_LEVEL_NOT_FOUND"
  | "MENTOR_REVIEW_LEVEL_WRONG_OWNER"
  | "MENTOR_REVIEW_LEVEL_NOT_CURRENT"
  | "MENTOR_REVIEW_LEVEL_NOT_STARTED"
  | "MENTOR_REVIEW_NOT_PENDING"
  | "MENTOR_REVIEW_CONFLICT"
  | "MENTOR_REVIEW_STATE_CORRUPT"
  | "MENTOR_REVIEW_INTERNAL_ERROR";

export class MentorReviewError extends Error {
  readonly code: MentorReviewErrorCode;
  constructor(code: MentorReviewErrorCode, message: string) {
    super(message);
    this.name = "MentorReviewError";
    this.code = code;
  }
}

export function isMentorReviewError(error: unknown): error is MentorReviewError {
  return error instanceof MentorReviewError;
}

function fail(code: MentorReviewErrorCode, message: string): never {
  throw new MentorReviewError(code, message);
}

type Db = Pick<PrismaClient, "$transaction">;

/* ------------------------------------------------------------------------ */
/* Learner half — in_progress -> pending_review                              */
/* ------------------------------------------------------------------------ */

export type RequestMentorReviewInput = {
  /** From the session. There is no field through which this can be set. */
  actorUserId: number;
  stableCode: string;
  evaluationTime?: Date;
  db?: Db;
};

export type MentorReviewRequestReceipt = {
  /** False when the level was already awaiting review. */
  created: boolean;
  state: "pending_review";
  levelNumber: number;
  stableCode: string;
  requestedAt: string;
};

export type MentorReviewApprovalReceipt = {
  /** False on an idempotent repeat of an approval that already happened. */
  created: boolean;
  state: "completed";
  levelNumber: number;
  stableCode: string;
  learnerUserId: number;
  reviewerUserId: number;
  reviewerRole: UserRole;
  xpAwarded: number;
  xpTransactionId: number | null;
  nextLevelNumber: number | null;
  terminal: boolean;
  completedAt: string;
};

async function loadLearnerLevel(
  tx: Prisma.TransactionClient,
  actorUserId: number,
  stableCode: string,
) {
  const user = await tx.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, status: true },
  });
  if (!user) fail("MENTOR_REVIEW_FORBIDDEN", "actor does not exist");
  if (user.status !== "active") fail("MENTOR_REVIEW_FORBIDDEN", "actor is not active");

  const enrollment = await tx.userCurriculumEnrollment.findFirst({
    where: { userId: user.id, status: { in: ["active", "completed"] } },
    orderBy: [{ status: "asc" }, { id: "desc" }],
    include: { curriculumVersion: { include: { levels: true } } },
  });
  if (!enrollment) fail("MENTOR_REVIEW_NOT_ENROLLED", "no curriculum enrollment");

  const level = enrollment.curriculumVersion.levels.find(
    (candidate) => candidate.stableCode === stableCode,
  );
  if (!level) fail("MENTOR_REVIEW_LEVEL_NOT_FOUND", "level is not in the pinned curriculum");
  if (!MENTOR_REVIEW_PAIRS.has(completionPair(level.type, level.completionMethod))) {
    fail("MENTOR_REVIEW_LEVEL_WRONG_OWNER", "level is not a mentor-review level");
  }
  return { user, enrollment, level };
}

/**
 * The learner submits their own mentor-review level for review.
 *
 * This is the ONLY transition a learner owns on this level, and it moves them
 * strictly further from being able to complete it: `pending_review` is the
 * state their own commands can no longer act on.
 *
 * Idempotent: a level already awaiting review returns `created: false` rather
 * than writing again, so a double-tap costs nothing and produces one audit
 * event, not two.
 */
export async function requestMentorReview({
  actorUserId,
  stableCode,
  evaluationTime,
  db = prisma,
}: RequestMentorReviewInput): Promise<MentorReviewRequestReceipt> {
  if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0) {
    fail("MENTOR_REVIEW_INPUT_INVALID", "actor is invalid");
  }
  if (typeof stableCode !== "string" || stableCode.trim().length === 0) {
    fail("MENTOR_REVIEW_INPUT_INVALID", "stableCode is invalid");
  }
  const now = evaluationTime ?? new Date();

  return db.$transaction(async (tx) => {
    const { user, enrollment, level } = await loadLearnerLevel(tx, actorUserId, stableCode);

    const progress = await tx.userLevelProgress.findFirst({
      where: { enrollmentId: enrollment.id, levelDefinitionId: level.id },
      select: { id: true, status: true, lastProgressAt: true },
    });
    if (!progress) {
      if (level.levelNumber !== enrollment.currentLevel) {
        fail("MENTOR_REVIEW_LEVEL_NOT_CURRENT", "level is not current");
      }
      fail("MENTOR_REVIEW_LEVEL_NOT_STARTED", "level was not started");
    }
    if (progress.status === "pending_review") {
      return {
        created: false,
        state: "pending_review" as const,
        levelNumber: level.levelNumber,
        stableCode: level.stableCode,
        requestedAt: (progress.lastProgressAt ?? now).toISOString(),
      };
    }
    // A completed level has nothing to submit, and there is deliberately no
    // path back: a learner cannot reopen a level a reviewer already approved.
    if (progress.status !== "in_progress") {
      fail("MENTOR_REVIEW_CONFLICT", "level is not awaiting the learner");
    }
    if (level.levelNumber !== enrollment.currentLevel) {
      fail("MENTOR_REVIEW_LEVEL_NOT_CURRENT", "level is not current");
    }

    // CAS on the exact state being left, so two concurrent submissions cannot
    // both write and the transition can never start from `completed`.
    const claimed = await tx.userLevelProgress.updateMany({
      where: { id: progress.id, status: "in_progress", completedAt: null },
      data: { status: "pending_review", lastProgressAt: now },
    });
    if (claimed.count !== 1) fail("MENTOR_REVIEW_CONFLICT", "review request lost the claim");

    // G4-GROWTH — the learner side of the mentor-review step.
    //
    // Emitted at the moment of the transition, which is the ONLY moment this
    // instant is knowable: `pending_review` is recorded on the progress row and
    // `lastProgressAt` is overwritten by whatever happens next, so a later
    // reader cannot reconstruct when the learner submitted. The migration
    // backfill can therefore only cover rows still awaiting review, and says so.
    await emitMentorReviewSubmittedEvent(tx, {
      userLevelProgressId: progress.id,
      enrollmentId: enrollment.id,
      userId: user.id,
      levelDefinitionId: level.id,
      levelNumber: level.levelNumber,
      occurredAt: now,
    });

    // LO-REVIEW-WORKITEM-UNREACHABLE-1 — the operational mirror, in this
    // transaction. Keyed on the progress row, which IS the canonical
    // mentor-review object, so a replayed request finds the same work item.
    // The learner is not staff, so the transition is recorded as the system's
    // rather than attributed to an employee who did nothing.
    await ensureMentorReviewWorkItem(tx, {
      userLevelProgressId: progress.id,
      userId: user.id,
      levelNumber: level.levelNumber,
      levelTitle: level.title,
      actor: null,
    });
    await reconcileMentorReviewOperationalState(tx, {
      userLevelProgressId: progress.id,
      canonicalState: "pending_review",
      actor: null,
      reason: "mentor_review:requested",
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: CURRICULUM_AUDIT_ACTIONS.mentorReviewRequested,
        entityType: "UserLevelProgress",
        entityId: String(progress.id),
        metadata: {
          userId: user.id,
          enrollmentId: enrollment.id,
          curriculumVersionId: enrollment.curriculumVersionId,
          levelDefinitionId: level.id,
          levelNumber: level.levelNumber,
          stableCode: level.stableCode,
        },
      },
    });

    return {
      created: true,
      state: "pending_review" as const,
      levelNumber: level.levelNumber,
      stableCode: level.stableCode,
      requestedAt: now.toISOString(),
    };
  });
}

/* ------------------------------------------------------------------------ */
/* Reviewer half — pending_review -> completed                               */
/* ------------------------------------------------------------------------ */

export type ApproveMentorReviewInput = {
  /** From the session. Never a body field, never a claimed role. */
  reviewerUserId: number;
  /**
   * The exact `UserLevelProgress` awaiting review.
   *
   * A reviewer legitimately acts on somebody else's work, so a target has to be
   * named — that is inherent to review, not a widening. What the reviewer CANNOT
   * do is name a learner, an enrollment, a level, a status or a reward: the
   * progress row determines all of those, and it must already be
   * `pending_review` on a mentor-review level for anything to happen.
   */
  progressId: number;
  evaluationTime?: Date;
  db?: Db;
};

export async function approveMentorReview({
  reviewerUserId,
  progressId,
  evaluationTime,
  db = prisma,
}: ApproveMentorReviewInput): Promise<MentorReviewApprovalReceipt> {
  if (!Number.isSafeInteger(reviewerUserId) || reviewerUserId <= 0) {
    fail("MENTOR_REVIEW_INPUT_INVALID", "reviewer is invalid");
  }
  if (!Number.isSafeInteger(progressId) || progressId <= 0) {
    fail("MENTOR_REVIEW_INPUT_INVALID", "progress identity is invalid");
  }
  const now = evaluationTime ?? new Date();

  return db.$transaction(async (tx) => {
    // Role is re-read from the database inside the transaction. Nothing the
    // request carried is consulted.
    const reviewer = await tx.user.findUnique({
      where: { id: reviewerUserId },
      select: { id: true, role: true, status: true },
    });
    if (!reviewer || reviewer.status !== "active" || !REVIEWER_ROLES.has(reviewer.role)) {
      fail("MENTOR_REVIEW_FORBIDDEN", "an active mentor or admin reviewer is required");
    }

    const progress = await tx.userLevelProgress.findUnique({
      where: { id: progressId },
      select: {
        id: true,
        status: true,
        enrollmentId: true,
        levelDefinitionId: true,
        levelDefinition: {
          select: { id: true, levelNumber: true, stableCode: true, type: true, completionMethod: true },
        },
        enrollment: { select: { id: true, userId: true, status: true } },
      },
    });
    if (!progress) fail("MENTOR_REVIEW_LEVEL_NOT_FOUND", "review target does not exist");
    if (!MENTOR_REVIEW_PAIRS.has(
      completionPair(progress.levelDefinition.type, progress.levelDefinition.completionMethod),
    )) {
      fail("MENTOR_REVIEW_LEVEL_WRONG_OWNER", "level is not a mentor-review level");
    }

    // THE RULE. Checked before any write, and before the state check, so an
    // attempt to self-approve leaves nothing behind and cannot be distinguished
    // by timing from a target that was not ready.
    if (progress.enrollment.userId === reviewer.id) {
      fail("MENTOR_REVIEW_SELF_REVIEW_FORBIDDEN", "a learner cannot approve their own review");
    }

    const view = {
      levelNumber: progress.levelDefinition.levelNumber,
      stableCode: progress.levelDefinition.stableCode,
      learnerUserId: progress.enrollment.userId,
      reviewerUserId: reviewer.id,
      reviewerRole: reviewer.role,
    };

    if (progress.status === "in_progress") {
      // The learner has not submitted it yet. Approving here would let a
      // reviewer finish work the learner never declared done.
      fail("MENTOR_REVIEW_NOT_PENDING", "level is not awaiting review");
    }

    let completion;
    try {
      // The canonical engine owns the transition, the XP award, the unlock, the
      // terminal case and the completion audit. `mentor_completion` requires
      // `pending_review`, so a row in any other state is refused THERE too.
      //
      // The source id is derived from durable state, not from the request, so a
      // second approval replays this completion rather than creating a second
      // one — whichever reviewer sends it.
      completion = await completeCurriculumLevelInTransaction(tx, {
        enrollmentId: progress.enrollmentId,
        levelDefinitionId: progress.levelDefinitionId,
        sourceType: "mentor_completion",
        sourceId: `mentor-review:${progress.id}`,
        // The REVIEWER is the actor: the completion audit records who approved.
        actorId: reviewer.id,
        evaluationTime: now,
      });
    } catch (error) {
      if (!isCurriculumLevelCompletionError(error)) throw error;
      switch (error.code) {
        case "COMPLETION_DISABLED":
          fail("MENTOR_REVIEW_DISABLED", "mentor review completion is disabled");
          break;
        case "COMPLETION_OWNER_MISMATCH":
        case "COMPLETION_OWNER_UNAVAILABLE":
          fail("MENTOR_REVIEW_NOT_PENDING", "level is not awaiting review");
          break;
        case "COMPLETION_LEVEL_NOT_CURRENT":
          fail("MENTOR_REVIEW_LEVEL_NOT_CURRENT", "level is not current");
          break;
        case "COMPLETION_IDEMPOTENCY_CONFLICT":
        case "COMPLETION_CONFLICT":
          fail("MENTOR_REVIEW_CONFLICT", "approval conflicts with the durable completion");
          break;
        case "COMPLETION_INPUT_INVALID":
          fail("MENTOR_REVIEW_INPUT_INVALID", "approval input is invalid");
          break;
        case "COMPLETION_INTERNAL_ERROR":
          fail("MENTOR_REVIEW_INTERNAL_ERROR", "mentor review approval failed");
          break;
        default:
          fail("MENTOR_REVIEW_STATE_CORRUPT", "curriculum state is corrupt");
      }
      throw error;
    }

    // LO-REVIEW-WORKITEM-UNREACHABLE-1 — resolve the operational mirror AFTER
    // the canonical completion has already happened in this same transaction.
    // The terminal invariant refuses `resolved` while the progress row is not
    // `completed`; by this line it is. A replayed approval finds the case
    // already resolved and the reconcile is a no-op, so there is no second
    // timeline entry and no second version bump.
    await reconcileMentorReviewOperationalState(tx, {
      userLevelProgressId: progress.id,
      canonicalState: "completed",
      actor: await resolveOperationalActor(tx, reviewer.id),
      reason: "mentor_review:approved",
    });

    return {
      created: completion.created,
      state: "completed" as const,
      ...view,
      xpAwarded: completion.xpAwarded,
      xpTransactionId: completion.xpTransactionId,
      nextLevelNumber: completion.nextLevelNumber,
      terminal: completion.terminal,
      completedAt: completion.completedAt.toISOString(),
    };
  });
}
