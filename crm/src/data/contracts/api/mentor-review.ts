/**
 * G3 — strict runtime contract for the Backend mentor-review reviewer API.
 *
 * Every schema is `.strict()`, for the same reason the report-review contract is:
 * an unexpected backend field becomes a loud failure here rather than a quiet
 * leak of learner data into a staff client.
 *
 * WHAT THIS CONTRACT DELIBERATELY DOES NOT HAVE
 * A rubric, a score, a rejection reason, a claim, a lease, a reassignment and a
 * revision. The canonical mentor-review lifecycle has exactly two transitions —
 * the learner's `in_progress -> pending_review` and the reviewer's
 * `pending_review -> completed` — so a schema for any of those would describe a
 * workflow the platform does not implement. If mentors are ever given a way to
 * return work, that is a product decision and a domain change first, and this
 * file follows it rather than anticipating it.
 *
 * WHAT A REVIEWER MAY SEE. The queue carries the level, when it was submitted,
 * and enough about the learner to know whose work it is. There is no email, no
 * financial field, no Pocket identity and no audit history, and `.strict()`
 * ensures one cannot appear without this file changing.
 */
import { z } from "zod";

/* ------------------------------------------------------------------- queue */

export const MentorQueueItemSchema = z
  .object({
    /** The identity the approve command takes. Reviewer-only; never learner-facing. */
    progressId: z.number().int().positive(),
    levelNumber: z.number().int().positive(),
    stableCode: z.string().min(1),
    levelTitle: z.string().min(1),
    /** The canonical reward, so a reviewer knows what approval grants. */
    xpReward: z.number().int().min(0),
    learnerUserId: z.number().int().positive(),
    /** Display name only. Never an email. */
    learnerName: z.string().nullable(),
    requestedAt: z.string().nullable(),
    curriculumCode: z.string().min(1),
    curriculumVersionNumber: z.number().int().positive(),
    /**
     * §15 — the operational half of the same work. A pointer, never authority:
     * the educational decision stays with the canonical approve command below.
     */
    operationalWorkItem: z
      .object({
        caseId: z.string().min(1),
        reference: z.string().min(1),
        status: z.string().min(1),
        assignedStaffDisplayName: z.string().nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type MentorQueueItem = z.infer<typeof MentorQueueItemSchema>;

export const MentorQueuePageSchema = z
  .object({
    items: z.array(MentorQueueItemSchema),
    nextCursor: z.number().int().positive().nullable(),
  })
  .strict();

export type MentorQueuePage = z.infer<typeof MentorQueuePageSchema>;

/* ---------------------------------------------------------------- approval */

/**
 * The approval receipt.
 *
 * `created: false` is an idempotent replay — the same reviewer approving twice.
 * It is a SUCCESS, not an error: the level completed exactly once either way,
 * and telling a reviewer their second click failed would be untrue.
 */
export const MentorApprovalResultSchema = z
  .object({
    ok: z.literal(true),
    created: z.boolean(),
    state: z.literal("completed"),
    levelNumber: z.number().int().positive(),
    stableCode: z.string().min(1),
    learnerUserId: z.number().int().positive(),
    reviewerUserId: z.number().int().positive(),
    reviewerRole: z.string().min(1),
    xpAwarded: z.number().int().min(0),
    xpTransactionId: z.number().int().positive().nullable(),
    nextLevelNumber: z.number().int().positive().nullable(),
    terminal: z.boolean(),
    completedAt: z.string().min(1),
  })
  .strict();

export type MentorApprovalResult = z.infer<typeof MentorApprovalResultSchema>;

/** The Backend's bounded error envelope for this lifecycle. */
export const MentorErrorSchema = z
  .object({
    error: z.string().min(1),
    issues: z.array(z.unknown()).optional(),
  })
  .strict();

/* --------------------------------------------------------------- endpoints */

export const MENTOR_QUEUE_ENDPOINT = "/api/curriculum/v2/mentor-reviews/queue";

/** The approve command. `progressId` is a positive integer from the queue. */
export function mentorApproveEndpoint(progressId: number): string {
  return `/api/curriculum/v2/mentor-reviews/${progressId}/approve`;
}

/** Backend bounds on the queue page size. The Backend re-checks regardless. */
export const MENTOR_QUEUE_MIN_LIMIT = 1;
export const MENTOR_QUEUE_MAX_LIMIT = 50;
export const MENTOR_QUEUE_DEFAULT_LIMIT = 20;

/**
 * Conflict codes a reviewer can legitimately hit.
 *
 * `SELF_REVIEW_FORBIDDEN` should be unreachable — the queue already excludes the
 * reviewer's own work — but it is listed because the domain enforces it
 * independently and a bounded message is better than a generic failure.
 */
export const MENTOR_CONFLICT_CODES = [
  "MENTOR_REVIEW_CONFLICT",
  "MENTOR_REVIEW_NOT_PENDING",
  "MENTOR_REVIEW_LEVEL_WRONG_OWNER",
  "MENTOR_REVIEW_LEVEL_NOT_FOUND",
  "MENTOR_REVIEW_SELF_REVIEW_FORBIDDEN",
  "MENTOR_REVIEW_STATE_CORRUPT",
] as const;
