/**
 * G3 — the reviewer's mentor-review queue.
 *
 * WHY IT EXISTS
 * The approve command has always required a `progressId`, and nothing told a
 * reviewer which ones were waiting. A reviewer with the power to approve and no
 * way to discover work is not a workflow, which is why the 7 canonical
 * mentor-review levels had no usable staff path.
 *
 * WHAT IT IS
 * A bounded, read-only projection of durable state — rows that are ALREADY
 * `pending_review` on a level whose pair is ALREADY `mentor_review:mentor_review`.
 * It writes nothing, claims nothing, assigns nothing and changes no state.
 *
 * AUTHORIZATION IS THE SHIPPED ONE. `gateMentorReviewReviewer` — an active
 * `admin` or `mentor`, taken from the session, re-read from the database. There
 * is no new role and no query parameter through which a caller could widen what
 * they see: `reviewerUserId` comes from the gate, never from the request.
 *
 * A LEARNER CANNOT REACH THIS. The gate refuses before the query is parsed.
 */
import { z } from "zod";
import {
  listMentorReviewQueue,
  MENTOR_REVIEW_QUEUE_MAX_LIMIT,
} from "@/lib/curriculum/mentor-review-queue";
import {
  gateMentorReviewReviewer,
  mentorReviewData,
  mentorReviewError,
  mentorReviewException,
} from "@/lib/curriculum/mentor-review-http";

/** Strict: exactly two optional parameters, both bounded. Anything else is a 400. */
const querySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(MENTOR_REVIEW_QUEUE_MAX_LIMIT).optional(),
  cursor: z.coerce.number().int().positive().optional(),
});

export async function GET(request: Request) {
  const gate = await gateMentorReviewReviewer(request);
  if (!gate.ok) return gate.response;

  try {
    const url = new URL(request.url);
    const allowed = new Set(["limit", "cursor"]);
    for (const key of url.searchParams.keys()) {
      if (!allowed.has(key)) return mentorReviewError("INVALID_QUERY", 400);
    }

    const parsed = querySchema.safeParse({
      ...(url.searchParams.get("limit") !== null ? { limit: url.searchParams.get("limit") } : {}),
      ...(url.searchParams.get("cursor") !== null ? { cursor: url.searchParams.get("cursor") } : {}),
    });
    if (!parsed.success) return mentorReviewError("INVALID_QUERY", 400);

    const result = await listMentorReviewQueue({
      reviewerUserId: gate.actorId,
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
      ...(parsed.data.cursor !== undefined ? { cursor: parsed.data.cursor } : {}),
    });

    return mentorReviewData(result);
  } catch (error) {
    return mentorReviewException(error, "mentor review queue GET");
  }
}
