import { learnerOpsData, learnerOpsErrorResponse, parseJsonBody, requireLearnerOpsStaff } from "@/lib/learner-ops/http";
import { LearnerOpsError } from "@/lib/learner-ops/errors";
import { listEscalations, raiseEscalation } from "@/lib/learner-ops/escalation";
import { escalationSchema } from "@/lib/learner-ops/schemas";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    await requireLearnerOpsStaff(["learner_ops_view"]);
    const { caseId } = await params;
    return learnerOpsData({ items: await listEscalations(caseId) });
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops escalations GET");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const gate = await requireLearnerOpsStaff(["learner_ops_view", "learner_ops_escalate"]);
    const { caseId } = await params;
    const parsed = escalationSchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid body");
    return learnerOpsData(await raiseEscalation({ caseId, ...parsed.data, actor: gate.actor }), 201);
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops escalations POST");
  }
}
