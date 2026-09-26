import { learnerOpsData, learnerOpsErrorResponse, parseJsonBody, requireLearnerOpsStaff } from "@/lib/learner-ops/http";
import { LearnerOpsError } from "@/lib/learner-ops/errors";
import { transitionCase } from "@/lib/learner-ops/case";
import { transitionSchema } from "@/lib/learner-ops/schemas";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const gate = await requireLearnerOpsStaff(["learner_ops_view", "learner_ops_handle"]);
    const { caseId } = await params;
    const parsed = transitionSchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid body");

    return learnerOpsData(
      await transitionCase({ caseId, ...parsed.data, actor: gate.actor }),
    );
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops status POST");
  }
}
