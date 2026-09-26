/**
 * Community Home, in one read.
 *
 * Answers the questions Home exists to answer — where may I participate, what
 * is being asked there, and what opens next — from the learner's own
 * progression, resolved server-side.
 *
 * WHY ONE ROUTE AND NOT THREE. Home would otherwise fan out into a spaces read,
 * an activity read and a progression read, and the three could disagree about
 * the learner's position between round trips. One resolution, one answer.
 *
 * WHY THE PREVIEW IS PER SPACE AND NOT ONE GLOBAL "RECENT" LIST. The selected
 * art direction puts real discussions INSIDE each accessible plate. A single
 * pooled list sorted by time would starve a quieter space of its preview
 * entirely — the plate would read as empty while its space is not — and in
 * PREPROD, where most spaces are closed and the open one is quiet, that is the
 * common case rather than the edge case.
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

/** How many discussions each accessible plate previews. */
const PLATE_PREVIEW_LIMIT = 3;

export async function GET(request: Request) {
  const gate = await requireCommunityLearner(request, { mutation: false });
  if (isLearnerGateFailure(gate)) return gate.response;

  try {
    assertOnlyQueryParams(request, []);

    const isModerator = await resolveModeratorFlag();
    const access = await resolveCommunityAccess(gate.userId, { moderatorReadsAll: isModerator });

    const viewer = {
      viewerId: gate.userId,
      viewerIsModerator: isModerator,
      viewerModuleNumber: access.currentModuleNumber,
    };

    // Previews are read ONLY for spaces this learner may read. A preview of a
    // locked space would be a disclosure dressed as a teaser.
    const spaces = await Promise.all(
      access.spaces.map(async (space) => {
        // Removed discussions are excluded from the PREVIEW only. In the space
        // itself the tombstone stays, because a list that silently loses a row
        // is a list that hides moderation. Home has three slots and its job is
        // to show what is live, so a tombstone there is pure noise that crowds
        // out the discussion a learner could actually answer.
        const preview = space.canRead
          ? (await listSpaceDiscussions(space.spaceId, viewer))
              .filter((discussion) => !discussion.isRemoved)
              .slice(0, PLATE_PREVIEW_LIMIT)
          : [];
        return {
          code: space.code,
          title: space.title,
          purpose: space.purpose,
          canRead: space.canRead,
          canWrite: space.canWrite,
          lockedReason: space.lockedReason,
          requiredModuleNumber: space.requiredModuleNumber,
          preview,
        };
      }),
    );

    return communityData({
      enrolled: access.enrolled,
      currentModuleNumber: access.currentModuleNumber,
      completedLevels: access.completedLevels,
      isModerator,
      spaces,
    });
  } catch (error) {
    return communityErrorResponse(error, "overview");
  }
}
