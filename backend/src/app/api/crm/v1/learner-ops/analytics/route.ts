import { learnerOpsData, learnerOpsErrorResponse, requireLearnerOpsStaff } from "@/lib/learner-ops/http";
import { getAnalytics } from "@/lib/learner-ops/analytics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    await requireLearnerOpsStaff(["learner_ops_analytics"]);
    return learnerOpsData(await getAnalytics());
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops analytics GET");
  }
}
