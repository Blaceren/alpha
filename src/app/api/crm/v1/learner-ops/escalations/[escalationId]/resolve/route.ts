import { learnerOpsData, learnerOpsErrorResponse, parseJsonBody, requireLearnerOpsStaff } from "@/lib/learner-ops/http";
import { LearnerOpsError } from "@/lib/learner-ops/errors";
import { resolveEscalation } from "@/lib/learner-ops/escalation";
import { escalationResolveSchema } from "@/lib/learner-ops/schemas";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, { params }: { params: Promise<{ escalationId: string }> }) {
  try {
    const gate = await requireLearnerOpsStaff(["learner_ops_view", "learner_ops_escalate"]);
    const { escalationId } = await params;
    const parsed = escalationResolveSchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid body");
    return learnerOpsData(await resolveEscalation({ escalationId, ...parsed.data, actor: gate.actor }));
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops escalation resolve POST");
  }
}
