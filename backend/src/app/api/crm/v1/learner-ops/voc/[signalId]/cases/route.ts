import { learnerOpsData, learnerOpsErrorResponse, parseJsonBody, requireLearnerOpsStaff } from "@/lib/learner-ops/http";
import { LearnerOpsError } from "@/lib/learner-ops/errors";
import { linkVocCase } from "@/lib/learner-ops/quality";
import { vocLinkSchema } from "@/lib/learner-ops/schemas";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, { params }: { params: Promise<{ signalId: string }> }) {
  try {
    const gate = await requireLearnerOpsStaff(["learner_ops_view", "learner_ops_handle"]);
    const { signalId } = await params;
    const parsed = vocLinkSchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid body");
    return learnerOpsData(await linkVocCase({ signalId, caseId: parsed.data.caseId, actor: gate.actor }), 201);
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops voc link POST");
  }
}
