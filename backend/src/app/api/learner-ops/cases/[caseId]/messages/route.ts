/** The learner's reply. Writes to `LearnerOpsMessage` and nothing else. */
import {
  isLearnerGateFailure,
  learnerOpsData,
  learnerOpsErrorResponse,
  parseJsonBody,
  requireLearnerOpsLearner,
} from "@/lib/learner-ops/http";
import { LearnerOpsError } from "@/lib/learner-ops/errors";
import { addMessage } from "@/lib/learner-ops/case";
import { messageSchema } from "@/lib/learner-ops/schemas";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const gate = await requireLearnerOpsLearner(request, { mutation: true });
  if (isLearnerGateFailure(gate)) return gate.response;

  try {
    const { caseId } = await params;
    const parsed = messageSchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid body");

    // Ownership AND liveness in one lookup. A learner cannot append to a closed
    // case: that would silently reopen a conversation nobody is watching. They
    // open a new request instead, which lands in the queue where it will be seen.
    const owned = await prisma.learnerOpsCase.findFirst({
      where: { id: caseId, userId: gate.userId },
      select: { id: true, status: true },
    });
    if (!owned) throw new LearnerOpsError("LEARNER_OPS_CASE_NOT_FOUND");
    if (owned.status === "closed" || owned.status === "resolved") {
      throw new LearnerOpsError(
        "LEARNER_OPS_ALREADY_RESOLVED",
        "обращение закрыто — создайте новое",
      );
    }

    const result = await addMessage({
      caseId,
      body: parsed.data.body,
      author: { kind: "learner", userId: gate.userId },
    });
    return learnerOpsData({ id: result.id }, 201);
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner support message POST");
  }
}
