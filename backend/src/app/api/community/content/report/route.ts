/**
 * Report a discussion or a reply.
 *
 * ONE ROUTE FOR BOTH TARGETS, because it is one product action with one reason
 * vocabulary, and two routes would be two places for the reason list to drift.
 *
 * THE REPORTER IS NEVER RETURNED. Not to the author of the reported content,
 * not to other learners, and not as a count on anything. The response says only
 * that the report was received.
 */
import {
  communityData,
  communityErrorResponse,
  isLearnerGateFailure,
  parseJsonBody,
  requireCommunityLearner,
  resolveModeratorFlag,
  validateId,
} from "@/lib/community/http";
import { CommunityError } from "@/lib/community/errors";
import { findSpaceAccess, resolveCommunityAccess } from "@/lib/community/access";
import { reportContent } from "@/lib/community/service";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  const gate = await requireCommunityLearner(request, { mutation: true });
  if (isLearnerGateFailure(gate)) return gate.response;

  try {
    const body = await parseJsonBody(request);
    const rawDiscussionId = typeof body.discussionId === "string" ? body.discussionId : null;
    const rawReplyId = typeof body.replyId === "string" ? body.replyId : null;

    if ((rawDiscussionId ? 1 : 0) + (rawReplyId ? 1 : 0) !== 1) {
      throw new CommunityError("COMMUNITY_VALIDATION", "target_required");
    }

    const discussionId = rawDiscussionId
      ? validateId(rawDiscussionId, "COMMUNITY_DISCUSSION_NOT_FOUND")
      : undefined;
    const replyId = rawReplyId ? validateId(rawReplyId, "COMMUNITY_REPLY_NOT_FOUND") : undefined;

    // A learner may only report content they can actually see. Without this a
    // report endpoint would confirm the existence of content in a locked space.
    const spaceCode = discussionId
      ? (
          await prisma.communityDiscussion.findUnique({
            where: { id: discussionId },
            select: { space: { select: { code: true } } },
          })
        )?.space.code
      : (
          await prisma.communityReply.findUnique({
            where: { id: replyId },
            select: { discussion: { select: { space: { select: { code: true } } } } },
          })
        )?.discussion.space.code;

    if (!spaceCode) {
      throw new CommunityError(
        discussionId ? "COMMUNITY_DISCUSSION_NOT_FOUND" : "COMMUNITY_REPLY_NOT_FOUND",
      );
    }

    const isModerator = await resolveModeratorFlag();
    const access = await resolveCommunityAccess(gate.userId, { moderatorReadsAll: isModerator });
    const space = findSpaceAccess(access, spaceCode);
    if (!space || !space.canRead) {
      throw new CommunityError(
        discussionId ? "COMMUNITY_DISCUSSION_NOT_FOUND" : "COMMUNITY_REPLY_NOT_FOUND",
      );
    }

    await reportContent({
      reporterId: gate.userId,
      discussionId,
      replyId,
      reason: body.reason,
      note: body.note,
    });

    // No id, no status, no count. "Received" is the entire contract.
    return communityData({ received: true }, 201);
  } catch (error) {
    return communityErrorResponse(error, "content-report");
  }
}
