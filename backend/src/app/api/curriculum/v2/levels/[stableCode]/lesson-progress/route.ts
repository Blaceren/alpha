import { z } from "zod";
import { saveOwnLessonProgress } from "@/lib/curriculum/content-read-progress";
import { gatePhase4Self, idempotencyKey, jsonBody, phase4Data, phase4Exception, strictBody, strictQuery } from "@/lib/curriculum/phase4-http";

const section = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const bodySchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative().max(2_147_483_646),
  playbackPositionSeconds: z.number().int().nonnegative().max(2_147_483_647),
  completedSections: z.array(z.string().trim().max(64).regex(section)).max(100),
  progressData: z.strictObject({ activeSectionCode: z.string().trim().max(64).regex(section).nullable() }).nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ stableCode: string }> }) {
  const gate = await gatePhase4Self(request, "content", true); if (!gate.ok) return gate.response;
  try { strictQuery(request, []); const requestId = idempotencyKey(request); const body = strictBody(bodySchema, await jsonBody(request)); const result = await saveOwnLessonProgress({ actorUserId: gate.actorId, stableCode: (await params).stableCode, requestId, ...body }); return phase4Data({ applied: !result.retry, exactRetry: result.retry, acceptedRevision: result.acceptedRevision, appliedAt: result.appliedAt, progress: result.progress }); }
  catch (error) { return phase4Exception(error, "lesson progress PATCH"); }
}
