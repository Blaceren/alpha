/**
 * Create a discussion in a space.
 *
 * WRITE ACCESS IS CHECKED AGAINST THE SPACE, NOT THE SESSION. A learner who may
 * READ a space may not therefore post in it: the entry space opens for reading
 * at enrollment and for posting at level 4, and this is where that distinction
 * is enforced. A moderator gains no posting right here either — moderation
 * widens reading only.
 */
import {
  communityData,
  communityErrorResponse,
  isLearnerGateFailure,
  parseJsonBody,
  requireCommunityLearner,
  resolveModeratorFlag,
  validateSpaceCode,
} from "@/lib/community/http";
import { CommunityError } from "@/lib/community/errors";
import { findSpaceAccess, resolveCommunityAccess } from "@/lib/community/access";
import { createDiscussion } from "@/lib/community/service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, { params }: { params: Promise<{ spaceCode: string }> }) {
  const gate = await requireCommunityLearner(request, { mutation: true });
  if (isLearnerGateFailure(gate)) return gate.response;

  try {
    const { spaceCode } = await params;
    const code = validateSpaceCode(spaceCode);
    const body = await parseJsonBody(request);

    const isModerator = await resolveModeratorFlag();
    const access = await resolveCommunityAccess(gate.userId, { moderatorReadsAll: isModerator });
    const space = findSpaceAccess(access, code);
    if (!space) throw new CommunityError("COMMUNITY_SPACE_NOT_FOUND");
    if (!space.canRead) throw new CommunityError("COMMUNITY_FORBIDDEN", space.lockedReason ?? "level_incomplete");
    if (!space.canWrite) throw new CommunityError("COMMUNITY_FORBIDDEN", "write_level_incomplete");

    const result = await createDiscussion({
      spaceId: space.spaceId,
      authorId: gate.userId,
      title: body.title,
      body: body.body,
    });

    // A deduplicated submission is a 200 naming the row that already exists,
    // not a 201 for a row that was not created. The learner sees their
    // discussion either way, which is the only outcome that matters to them.
    return communityData({ id: result.id, deduplicated: result.deduplicated }, result.deduplicated ? 200 : 201);
  } catch (error) {
    return communityErrorResponse(error, "discussion-create");
  }
}
