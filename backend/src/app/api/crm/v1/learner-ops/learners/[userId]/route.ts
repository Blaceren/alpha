/**
 * Learner 360 — the operational read model.
 *
 * Permission-sensitive by section: the caller's own permission set decides
 * whether the financial section and the full email address are returned at all.
 * The gate is applied SERVER-SIDE and the omitted sections are absent from the
 * payload, not merely hidden by the client.
 */
import { learnerOpsData, learnerOpsErrorResponse, requireLearnerOpsStaff } from "@/lib/learner-ops/http";
import { LearnerOpsError } from "@/lib/learner-ops/errors";
import { getLearner360 } from "@/lib/learner-ops/learner-360";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const gate = await requireLearnerOpsStaff(["learner_ops_view"]);
    const { userId } = await params;
    const parsed = Number.parseInt(userId, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid learner id");
    }
    return learnerOpsData(await getLearner360({ userId: parsed, permissions: gate.permissions }));
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops learner360 GET");
  }
}
