import { learnerOpsData, learnerOpsErrorResponse, parseJsonBody, requireLearnerOpsStaff } from "@/lib/learner-ops/http";
import { LearnerOpsError } from "@/lib/learner-ops/errors";
import { resolveEscalation } from "@/lib/learner-ops/escalation";
import { escalationResolveSchema } from "@/lib/learner-ops/schemas";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, { params }: { params: Promise<{ escalationId: string }> }) {
  try {
    // LO-ESCALATION-RESOLVE-AUTHORITY-1 (contract v4). RESOLVING requires the
    // resolve permission and nothing else may substitute for it — not
    // `learner_ops_escalate`, which is the authority to RAISE, and not
    // `learner_ops_handle`, which is the authority to work the case. Owning the
    // case is not sufficient either: the escalation was raised precisely
    // because its owner could not answer it.
    const gate = await requireLearnerOpsStaff([
      "learner_ops_view",
      "learner_ops_escalation_resolve",
    ]);
    const { escalationId } = await params;
    const parsed = escalationResolveSchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid body");
    return learnerOpsData(await resolveEscalation({ escalationId, ...parsed.data, actor: gate.actor }));
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops escalation resolve POST");
  }
}
