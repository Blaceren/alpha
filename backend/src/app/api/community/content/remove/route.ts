/**
 * A learner withdraws their OWN discussion or reply.
 *
 * THIS ROUTE HAS NO MODERATION POWER. It calls the service with an `author`
 * actor, whose ownership condition is part of the write. A learner who names
 * somebody else's content gets a 403 no matter what their session holds — staff
 * removal lives behind the CRM permission gate, in a different route, and there
 * is no parameter here that could reach it.
 *
 * Removal is SOFT. The row keeps its place so the thread keeps its shape and
 * the replies underneath are never orphaned.
 */
import {
  communityData,
  communityErrorResponse,
  isLearnerGateFailure,
  parseJsonBody,
  requireCommunityLearner,
  validateId,
} from "@/lib/community/http";
import { CommunityError } from "@/lib/community/errors";
import { removeContent } from "@/lib/community/service";

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

    await removeContent({
      target: rawDiscussionId
        ? { kind: "discussion", id: validateId(rawDiscussionId, "COMMUNITY_DISCUSSION_NOT_FOUND") }
        : { kind: "reply", id: validateId(rawReplyId!, "COMMUNITY_REPLY_NOT_FOUND") },
      // Always `author`. This route cannot construct a staff actor.
      actor: { kind: "author", userId: gate.userId },
    });

    return communityData({ removed: true });
  } catch (error) {
    return communityErrorResponse(error, "content-remove");
  }
}
