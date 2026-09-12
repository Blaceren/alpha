import { assertOnlyQueryParams, learnerOpsData, learnerOpsErrorResponse, parseJsonBody, requireLearnerOpsStaff } from "@/lib/learner-ops/http";
import { LearnerOpsError } from "@/lib/learner-ops/errors";
import { createVocSignal, listVocSignals } from "@/lib/learner-ops/quality";
import { vocCreateSchema } from "@/lib/learner-ops/schemas";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const querySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().min(1).max(256).optional(),
  status: z.enum(["open", "under_review", "accepted", "rejected", "resolved"]).optional(),
});

export async function GET(request: Request) {
  try {
    await requireLearnerOpsStaff(["learner_ops_view"]);
    assertOnlyQueryParams(request, ["limit", "cursor", "status"]);
    const params = new URL(request.url).searchParams;
    const raw = Object.fromEntries(
      ["limit", "cursor", "status"].filter((k) => params.get(k) !== null).map((k) => [k, params.get(k)]),
    );
    const parsed = querySchema.safeParse(raw);
    if (!parsed.success) throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid query");
    return learnerOpsData(await listVocSignals(parsed.data));
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops voc GET");
  }
}

export async function POST(request: Request) {
  try {
    const gate = await requireLearnerOpsStaff(["learner_ops_view", "learner_ops_handle"]);
    const parsed = vocCreateSchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid body");
    return learnerOpsData(await createVocSignal({ ...parsed.data, actor: gate.actor }), 201);
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops voc POST");
  }
}
