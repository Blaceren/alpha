/**
 * A4 — the learner half: submit a mentor-review level for review.
 *
 * The ONLY transition a learner owns on a `mentor_review:mentor_review` level,
 * and it moves them strictly further from being able to finish it —
 * `pending_review` is the state their own commands can no longer act on, and
 * the only owner that can leave it is `mentor_completion`.
 *
 * The body is empty by contract: there is nothing for a learner to submit here
 * beyond the fact that they are done. A rubric, a score or an attachment would
 * be the REPORT workflow, which has its own tables, its own route family and
 * its own phase.
 */
import { STABLE_CODE_PATTERN } from "@/lib/curriculum/constants";
import {
  assertNoMentorReviewQuery,
  gateMentorReviewSelf,
  isMentorReviewQueryMarker,
  mentorReviewData,
  mentorReviewError,
  mentorReviewException,
} from "@/lib/curriculum/mentor-review-http";
import { requestMentorReview } from "@/lib/curriculum/mentor-review";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ stableCode: string }> },
) {
  const gate = await gateMentorReviewSelf(request);
  if (!gate.ok) return gate.response;

  try {
    assertNoMentorReviewQuery(request);
    const { stableCode } = await params;
    if (!STABLE_CODE_PATTERN.test(stableCode)) {
      return mentorReviewError("MENTOR_REVIEW_INPUT_INVALID", 400, [
        { code: "INPUT_INVALID", reference: "stableCode" },
      ]);
    }

    const receipt = await requestMentorReview({
      actorUserId: gate.actorId,
      stableCode,
    });
    return mentorReviewData({ ok: true, ...receipt });
  } catch (error) {
    if (isMentorReviewQueryMarker(error)) {
      return mentorReviewError("INVALID_QUERY", 400);
    }
    return mentorReviewException(error, "mentor review request POST");
  }
}
