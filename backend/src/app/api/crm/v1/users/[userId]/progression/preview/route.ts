/**
 * POST /api/crm/v1/users/[userId]/progression/preview
 *
 * PURE. It answers "what would this correction do?" and writes nothing — no
 * progress row, no audit row, no growth event, no XP, not even
 * `lastMeaningfulActionAt`. A regression asserts that by comparing every
 * mutable table before and after.
 *
 * It is a POST rather than a GET because it carries a body (the target), not
 * because it mutates. The `no-store` header and the absence of any write are
 * what make that safe to say.
 *
 * IT REQUIRES THE OVERRIDE PERMISSION, not the read permission. A consequence
 * preview is a step in performing the action, and showing "here is what would
 * happen if you moved this learner" to somebody who may not move them is an
 * invitation, not information.
 */
import {
  assertNoQueryParams,
  parseLearnerUserId,
  parseStrictJson,
  previewBodySchema,
  progressionData,
  progressionErrorResponse,
  requireProgressionStaff,
} from "@/lib/crm/progression-http";
import { previewProgressionAdjustment } from "@/lib/curriculum/progression-adjustment";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    await requireProgressionStaff(request, "override");
    assertNoQueryParams(request);
    const body = await parseStrictJson(request, previewBodySchema);
    const { userId } = await context.params;
    const plan = await previewProgressionAdjustment({
      learnerUserId: parseLearnerUserId(userId),
      targetStableCode: body.targetStableCode,
    });
    return progressionData(plan);
  } catch (error) {
    return progressionErrorResponse(error, "crm progression preview POST");
  }
}
