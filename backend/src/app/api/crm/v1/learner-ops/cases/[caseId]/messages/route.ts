/**
 * LEARNER-VISIBLE communication on a case.
 *
 * This route reads and writes `LearnerOpsMessage` and names no other table.
 * The internal-note table has its OWN route, its own module function and its
 * own permission check — there is no parameter here that turns a reply into a
 * private note, and none there that turns a note into a reply.
 */
import { assertOnlyQueryParams, learnerOpsData, learnerOpsErrorResponse, parseJsonBody, requireLearnerOpsStaff } from "@/lib/learner-ops/http";
import { LearnerOpsError } from "@/lib/learner-ops/errors";
import { addMessage, notifyLearnerOfReply } from "@/lib/learner-ops/case";
import { getCaseDetail, listMessages } from "@/lib/learner-ops/queue";
import { listQuerySchema, messageSchema } from "@/lib/learner-ops/schemas";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    await requireLearnerOpsStaff(["learner_ops_view"]);
    assertOnlyQueryParams(request, ["limit", "cursor"]);
    const { caseId } = await params;
    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse({
      ...(url.searchParams.get("limit") !== null ? { limit: url.searchParams.get("limit") } : {}),
      ...(url.searchParams.get("cursor") !== null ? { cursor: url.searchParams.get("cursor") } : {}),
    });
    if (!parsed.success) throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid query");
    return learnerOpsData(await listMessages(caseId, parsed.data.limit, parsed.data.cursor));
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops messages GET");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const gate = await requireLearnerOpsStaff(["learner_ops_view", "learner_ops_handle"]);
    const { caseId } = await params;
    const parsed = messageSchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid body");

    const result = await addMessage({
      caseId,
      body: parsed.data.body,
      author: { kind: "staff", staffId: gate.actor.staffId, userId: gate.actor.userId },
    });

    // After the commit. The reply is already durable, so a notification failure
    // cannot cost the learner their answer.
    if (result.notify !== null) {
      const target = await getCaseDetail(caseId);
      await notifyLearnerOfReply({
        userId: result.notify,
        caseId,
        reference: target.reference,
      });
    }

    return learnerOpsData({ id: result.id, firstResponseRecorded: result.firstResponseRecorded }, 201);
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops messages POST");
  }
}
