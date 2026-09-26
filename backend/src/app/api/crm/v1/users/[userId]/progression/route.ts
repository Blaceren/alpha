/**
 * GET /api/crm/v1/users/[userId]/progression
 *
 * The canonical V2 progression snapshot for one learner — the read that replaces
 * `User.level` / `User.xp` on the CRM learner detail. Gated by
 * `canViewProgression`, which accepts `learner_ops_view` OR
 * `curriculum_progress_override`, so an operator who may correct progression can
 * always see what they are correcting without also holding the Learner
 * Operations case workspace.
 */
import {
  assertNoQueryParams,
  parseLearnerUserId,
  progressionData,
  progressionErrorResponse,
  requireProgressionStaff,
} from "@/lib/crm/progression-http";
import { resolveLearnerProgressionSnapshot } from "@/lib/curriculum/progression-read";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ userId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireProgressionStaff(request, "read");
    assertNoQueryParams(request);
    const { userId } = await context.params;
    const snapshot = await resolveLearnerProgressionSnapshot(parseLearnerUserId(userId));
    return progressionData(snapshot);
  } catch (error) {
    return progressionErrorResponse(error, "crm progression GET");
  }
}
