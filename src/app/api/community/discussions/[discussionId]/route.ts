/**
 * One thread: the discussion and its replies.
 *
 * The thread is fetched first and its SPACE is then checked against the
 * learner's access, so naming a discussion id inside a locked space returns the
 * same refusal as naming one that does not exist. The route is not an existence
 * oracle for content the learner may not read.
 */
import {
  assertOnlyQueryParams,
  communityData,
  communityErrorResponse,
  isLearnerGateFailure,
  requireCommunityLearner,
  resolveModeratorFlag,
  validateId,
} from "@/lib/community/http";
import { CommunityError } from "@/lib/community/errors";
import { findSpaceAccess, resolveCommunityAccess } from "@/lib/community/access";
import { getThread } from "@/lib/community/service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ discussionId: string }> },
) {
  const gate = await requireCommunityLearner(request, { mutation: false });
  if (isLearnerGateFailure(gate)) return gate.response;

  try {
    assertOnlyQueryParams(request, []);
    const { discussionId } = await params;
    const id = validateId(discussionId, "COMMUNITY_DISCUSSION_NOT_FOUND");

    const isModerator = await resolveModeratorFlag();
    const access = await resolveCommunityAccess(gate.userId, { moderatorReadsAll: isModerator });

    const thread = await getThread(id, {
      viewerId: gate.userId,
      viewerIsModerator: isModerator,
      viewerModuleNumber: access.currentModuleNumber,
    });

    const space = findSpaceAccess(access, thread.spaceCode);
    if (!space || !space.canRead) throw new CommunityError("COMMUNITY_DISCUSSION_NOT_FOUND");

    return communityData({
      discussion: {
        id: thread.id,
        title: thread.title,
        author: thread.author,
        body: thread.body,
        createdAt: thread.createdAt,
        canRemove: thread.canRemove,
        canReport: thread.canReport,
      },
      space: { code: space.code, title: space.title, canWrite: space.canWrite },
      replies: thread.replies,
    });
  } catch (error) {
    return communityErrorResponse(error, "thread-read");
  }
}
