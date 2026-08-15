/**
 * Claim, release and reassign.
 *
 * TAKING YOUR OWN WORK AND DIRECTING SOMEBODY ELSE'S ARE DIFFERENT POWERS, and
 * this route enforces that difference: assigning the case to yourself (or
 * releasing your own) needs `learner_ops_handle`, while naming ANOTHER staff
 * member additionally needs `learner_ops_manage_queues`.
 */
import { learnerOpsData, learnerOpsErrorResponse, parseJsonBody, requireLearnerOpsStaff } from "@/lib/learner-ops/http";
import { LearnerOpsError } from "@/lib/learner-ops/errors";
import { assignCase } from "@/lib/learner-ops/case";
import { assignSchema } from "@/lib/learner-ops/schemas";
import { canManageLearnerOpsQueues } from "@/lib/crm/roles";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const gate = await requireLearnerOpsStaff(["learner_ops_view", "learner_ops_handle"]);
    const { caseId } = await params;
    const parsed = assignSchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid body");

    const targetsSomeoneElse =
      parsed.data.targetStaffId !== null && parsed.data.targetStaffId !== gate.actor.staffId;
    if (targetsSomeoneElse && !canManageLearnerOpsQueues(gate.permissions)) {
      throw new LearnerOpsError("LEARNER_OPS_FORBIDDEN");
    }

    return learnerOpsData(await assignCase({ caseId, ...parsed.data, actor: gate.actor }));
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops assign POST");
  }
}
