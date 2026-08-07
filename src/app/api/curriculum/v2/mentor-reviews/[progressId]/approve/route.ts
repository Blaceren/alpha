/**
 * A4 — the reviewer half: approve a mentor-review level.
 *
 * WHY THE TARGET IS NAMED IN THE PATH
 * A reviewer acts on somebody else's work — that is what review is — so a target
 * has to be identified. What the reviewer CANNOT do is choose what happens to
 * it: the named `UserLevelProgress` row determines the learner, the enrollment,
 * the level and the reward, and it must already be `pending_review` on a
 * `mentor_review:mentor_review` level or the command refuses.
 *
 * WHY IT IS NOT A LEARNER-FACING IDENTIFIER
 * This route is reachable only by an active `admin` or `mentor`. It exposes no
 * learner-facing enumerable identity: an unauthorized caller is refused by the
 * gate before the path is even parsed, and an authorized reviewer naming a row
 * that is not a pending mentor review gets a refusal that says only that.
 *
 * THE LEARNER CANNOT REACH THIS. `gateMentorReviewReviewer` requires the
 * reviewer role from the session, and the domain refuses again when the
 * reviewer owns the enrollment — so an admin or mentor still cannot approve
 * their own level.
 *
 * The body is empty by contract. A rubric score, a rejection reason or a
 * comment would be the REPORT workflow.
 */
import { approveMentorReview } from "@/lib/curriculum/mentor-review";
import {
  assertNoMentorReviewQuery,
  gateMentorReviewReviewer,
  isMentorReviewPathMarker,
  isMentorReviewQueryMarker,
  mentorReviewData,
  mentorReviewError,
  mentorReviewException,
  mentorReviewPathId,
} from "@/lib/curriculum/mentor-review-http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ progressId: string }> },
) {
  const gate = await gateMentorReviewReviewer(request);
  if (!gate.ok) return gate.response;

  try {
    assertNoMentorReviewQuery(request);
    const { progressId } = await params;

    const receipt = await approveMentorReview({
      reviewerUserId: gate.actorId,
      progressId: mentorReviewPathId(progressId),
    });
    return mentorReviewData({ ok: true, ...receipt });
  } catch (error) {
    if (isMentorReviewQueryMarker(error)) {
      return mentorReviewError("INVALID_QUERY", 400);
    }
    if (isMentorReviewPathMarker(error)) {
      return mentorReviewError("MENTOR_REVIEW_INPUT_INVALID", 400, [
        { code: "INPUT_INVALID", reference: "progressId" },
      ]);
    }
    return mentorReviewException(error, "mentor review approve POST");
  }
}
