import { learnerOpsData, learnerOpsErrorResponse, requireLearnerOpsStaff } from "@/lib/learner-ops/http";
import { getCaseDetail } from "@/lib/learner-ops/queue";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    await requireLearnerOpsStaff(["learner_ops_view"]);
    const { caseId } = await params;
    return learnerOpsData(await getCaseDetail(caseId));
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops case GET");
  }
}
