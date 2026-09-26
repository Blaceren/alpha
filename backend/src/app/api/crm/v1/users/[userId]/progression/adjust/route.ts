/**
 * POST /api/crm/v1/users/[userId]/progression/adjust
 *
 * The mutation. GATE ORDER, STRICT AND IN THIS ORDER:
 *
 *   1. session + `curriculum_progress_override` + per-operator rate limit
 *   2. CSRF          -- this is a browser-reachable mutation
 *   3. no query params
 *   4. strict body   -- an unknown key is a 400, never a silently dropped extra
 *   5. domain        -- which re-plans inside its own transaction and re-checks
 *                       the actor, the enrollment, the version pin, the expected
 *                       current level and every protected gate before writing
 *
 * The preview the operator saw is never trusted as authority: the domain
 * recomputes the plan and compares it against `expectedCurrentLevel` and
 * `expectedCurriculumVersionId`, so a learner who progressed while the operator
 * was deciding produces a typed 409 rather than a correction nobody approved.
 */
import {
  adjustBodySchema,
  assertNoQueryParams,
  assertProgressionCsrf,
  parseLearnerUserId,
  parseStrictJson,
  progressionData,
  progressionErrorResponse,
  requireProgressionStaff,
} from "@/lib/crm/progression-http";
import { adjustLearnerProgression } from "@/lib/curriculum/progression-adjustment";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const gate = await requireProgressionStaff(request, "override");
    const csrfFailure = await assertProgressionCsrf(request);
    if (csrfFailure) return csrfFailure;
    assertNoQueryParams(request);

    const body = await parseStrictJson(request, adjustBodySchema);
    const { userId } = await context.params;

    const receipt = await adjustLearnerProgression({
      actorStaffProfileId: gate.actorStaffProfileId,
      actorUserId: gate.actorUserId,
      learnerUserId: parseLearnerUserId(userId),
      targetStableCode: body.targetStableCode,
      expectedCurrentLevel: body.expectedCurrentLevel,
      expectedCurriculumVersionId: body.expectedCurriculumVersionId,
      reasonCode: body.reasonCode,
      reasonText: body.reasonText,
      referenceId: body.referenceId ?? null,
      requestId: body.requestId,
    });
    return progressionData(receipt, receipt.created ? 201 : 200);
  } catch (error) {
    return progressionErrorResponse(error, "crm progression adjust POST");
  }
}
