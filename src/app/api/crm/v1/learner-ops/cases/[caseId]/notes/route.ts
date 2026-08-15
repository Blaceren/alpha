/**
 * INTERNAL operational notes. Never learner-visible.
 *
 * There is no learner-facing route anywhere in this codebase that reads
 * `LearnerOpsNote`, and the learner thread projection does not import it. The
 * separation is structural, not a predicate.
 */
import { assertOnlyQueryParams, learnerOpsData, learnerOpsErrorResponse, parseJsonBody, requireLearnerOpsStaff } from "@/lib/learner-ops/http";
import { LearnerOpsError } from "@/lib/learner-ops/errors";
import { addNote } from "@/lib/learner-ops/case";
import { listNotes } from "@/lib/learner-ops/queue";
import { listQuerySchema, noteSchema } from "@/lib/learner-ops/schemas";

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
    return learnerOpsData(await listNotes(caseId, parsed.data.limit, parsed.data.cursor));
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops notes GET");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const gate = await requireLearnerOpsStaff(["learner_ops_view", "learner_ops_handle"]);
    const { caseId } = await params;
    const parsed = noteSchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid body");
    return learnerOpsData(await addNote({ caseId, body: parsed.data.body, actor: gate.actor }), 201);
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops notes POST");
  }
}
