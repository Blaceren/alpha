/**
 * Reply to a discussion.
 *
 * The space's WRITE access is asserted through the discussion, so a learner who
 * can read a thread in a space they cannot post in can read it and not answer
 * — which is the intended shape of the pre-level-4 entry space.
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
import { createReply } from "@/lib/community/service";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ discussionId: string }> },
) {
  const gate = await requireCommunityLearner(request, { mutation: true });
  if (isLearnerGateFailure(gate)) return gate.response;

  try {
    const { discussionId } = await params;
    const id = validateId(discussionId, "COMMUNITY_DISCUSSION_NOT_FOUND");
    const body = await parseJsonBody(request);

    const located = await prisma.communityDiscussion.findUnique({
      where: { id },
      select: { space: { select: { code: true } } },
    });
    if (!located) throw new CommunityError("COMMUNITY_DISCUSSION_NOT_FOUND");

    const isModerator = await resolveModeratorFlag();
    const access = await resolveCommunityAccess(gate.userId, { moderatorReadsAll: isModerator });
    const space = findSpaceAccess(access, located.space.code);
    if (!space || !space.canRead) throw new CommunityError("COMMUNITY_DISCUSSION_NOT_FOUND");
    if (!space.canWrite) throw new CommunityError("COMMUNITY_FORBIDDEN", "write_level_incomplete");

    const result = await createReply({ discussionId: id, authorId: gate.userId, body: body.body });
    return communityData({ id: result.id, deduplicated: result.deduplicated }, result.deduplicated ? 200 : 201);
  } catch (error) {
    return communityErrorResponse(error, "reply-create");
  }
}
