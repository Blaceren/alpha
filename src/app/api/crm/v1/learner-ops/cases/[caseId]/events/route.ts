import { assertOnlyQueryParams, learnerOpsData, learnerOpsErrorResponse, requireLearnerOpsStaff } from "@/lib/learner-ops/http";
import { LearnerOpsError } from "@/lib/learner-ops/errors";
import { listEvents } from "@/lib/learner-ops/queue";
import { listQuerySchema } from "@/lib/learner-ops/schemas";

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
    return learnerOpsData(await listEvents(caseId, parsed.data.limit, parsed.data.cursor));
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops events GET");
  }
}
