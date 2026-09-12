import { assertOnlyQueryParams, learnerOpsData, learnerOpsErrorResponse, requireLearnerOpsStaff } from "@/lib/learner-ops/http";
import { LearnerOpsError } from "@/lib/learner-ops/errors";
import { listQaReviews } from "@/lib/learner-ops/quality";
import { listQuerySchema } from "@/lib/learner-ops/schemas";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    await requireLearnerOpsStaff(["learner_ops_view", "learner_ops_qa"]);
    assertOnlyQueryParams(request, ["limit", "cursor"]);
    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse({
      ...(url.searchParams.get("limit") !== null ? { limit: url.searchParams.get("limit") } : {}),
      ...(url.searchParams.get("cursor") !== null ? { cursor: url.searchParams.get("cursor") } : {}),
    });
    if (!parsed.success) throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid query");
    return learnerOpsData(await listQaReviews(parsed.data));
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops qa GET");
  }
}
