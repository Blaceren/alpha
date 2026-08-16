/**
 * Community Home, in one read.
 *
 * Answers the four questions Home exists to answer — where may I participate,
 * what is happening there, what relates to where I am, and what should I read
 * first — from the learner's own progression, resolved server-side.
 *
 * WHY ONE ROUTE AND NOT THREE. Home would otherwise fan out into a spaces read,
 * a recent-activity read and a progression read, and the three could disagree
 * about the learner's position between round trips. One resolution, one answer.
 */
import {
  assertOnlyQueryParams,
  communityData,
  communityErrorResponse,
  isLearnerGateFailure,
  requireCommunityLearner,
  resolveModeratorFlag,
} from "@/lib/community/http";
import { resolveCommunityAccess } from "@/lib/community/access";
import { listSpaceDiscussions } from "@/lib/community/service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** How many recent discussions Home shows across the readable spaces. */
const HOME_RECENT_LIMIT = 6;

export async function GET(request: Request) {
  const gate = await requireCommunityLearner(request, { mutation: false });
  if (isLearnerGateFailure(gate)) return gate.response;

  try {
    assertOnlyQueryParams(request, []);

    const isModerator = await resolveModeratorFlag();
    const access = await resolveCommunityAccess(gate.userId, { moderatorReadsAll: isModerator });

    // Recent activity is drawn ONLY from spaces this learner may read. A
    // preview of a locked space would be a disclosure dressed as a teaser.
    const readable = access.spaces.filter((space) => space.canRead);
    const perSpace = await Promise.all(
      readable.map(async (space) => {
        const discussions = await listSpaceDiscussions(space.spaceId, {
          viewerId: gate.userId,
          viewerIsModerator: isModerator,
          viewerModuleNumber: access.currentModuleNumber,
        });
        return discussions.map((discussion) => ({ ...discussion, spaceCode: space.code, spaceTitle: space.title }));
      }),
    );

    const recent = perSpace
      .flat()
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
      .slice(0, HOME_RECENT_LIMIT);

    return communityData({
      enrolled: access.enrolled,
      currentModuleNumber: access.currentModuleNumber,
      completedLevels: access.completedLevels,
      isModerator,
      spaces: access.spaces.map((space) => ({
        code: space.code,
        title: space.title,
        purpose: space.purpose,
        canRead: space.canRead,
        canWrite: space.canWrite,
        lockedReason: space.lockedReason,
        requiredModuleNumber: space.requiredModuleNumber,
        discussionCount: perSpace
          .flat()
          .filter((discussion) => discussion.spaceCode === space.code).length,
      })),
      recent,
    });
  } catch (error) {
    return communityErrorResponse(error, "overview");
  }
}
