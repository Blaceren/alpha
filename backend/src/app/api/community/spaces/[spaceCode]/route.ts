/**
 * One space and its discussions.
 *
 * ACCESS IS PART OF THE LOOKUP. The space is resolved through
 * `resolveCommunityAccess`, so a learner naming a space they cannot read gets a
 * 403 that explains the real requirement — and never the discussions.
 */
import {
  assertOnlyQueryParams,
  communityData,
  communityErrorResponse,
  isLearnerGateFailure,
  requireCommunityLearner,
  resolveModeratorFlag,
  validateSpaceCode,
} from "@/lib/community/http";
import { CommunityError } from "@/lib/community/errors";
import { findSpaceAccess, resolveCommunityAccess } from "@/lib/community/access";
import { listSpaceDiscussions } from "@/lib/community/service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, { params }: { params: Promise<{ spaceCode: string }> }) {
  const gate = await requireCommunityLearner(request, { mutation: false });
  if (isLearnerGateFailure(gate)) return gate.response;

  try {
    assertOnlyQueryParams(request, []);
    const { spaceCode } = await params;
    const code = validateSpaceCode(spaceCode);

    const isModerator = await resolveModeratorFlag();
    const access = await resolveCommunityAccess(gate.userId, { moderatorReadsAll: isModerator });
    const space = findSpaceAccess(access, code);
    if (!space) throw new CommunityError("COMMUNITY_SPACE_NOT_FOUND");

    if (!space.canRead) {
      // 403 carrying the REQUIREMENT, not a level number. The Academy renders
      // «Откроется после завершения модуля N» from this, so the learner reads
      // what to do rather than what they lack.
      return communityErrorResponse(
        new CommunityError("COMMUNITY_FORBIDDEN", space.lockedReason ?? "level_incomplete"),
        "space-locked",
      );
    }

    const discussions = await listSpaceDiscussions(space.spaceId, {
      viewerId: gate.userId,
      viewerIsModerator: isModerator,
      viewerModuleNumber: access.currentModuleNumber,
    });

    return communityData({
      space: {
        code: space.code,
        title: space.title,
        purpose: space.purpose,
        canWrite: space.canWrite,
        lockedReason: space.lockedReason,
        requiredModuleNumber: space.requiredModuleNumber,
      },
      discussions,
    });
  } catch (error) {
    return communityErrorResponse(error, "space-read");
  }
}
