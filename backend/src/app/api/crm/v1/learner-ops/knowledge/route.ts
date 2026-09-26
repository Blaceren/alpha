import { assertOnlyQueryParams, learnerOpsData, learnerOpsErrorResponse, parseJsonBody, requireLearnerOpsStaff } from "@/lib/learner-ops/http";
import { LearnerOpsError } from "@/lib/learner-ops/errors";
import { createKnowledgeArticle, listKnowledge } from "@/lib/learner-ops/quality";
import { knowledgeCreateSchema } from "@/lib/learner-ops/schemas";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const querySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().min(1).max(256).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  search: z.string().trim().min(1).max(80).optional(),
});

export async function GET(request: Request) {
  try {
    await requireLearnerOpsStaff(["learner_ops_view"]);
    assertOnlyQueryParams(request, ["limit", "cursor", "status", "search"]);
    const params = new URL(request.url).searchParams;
    const raw = Object.fromEntries(
      ["limit", "cursor", "status", "search"]
        .filter((key) => params.get(key) !== null)
        .map((key) => [key, params.get(key)]),
    );
    const parsed = querySchema.safeParse(raw);
    if (!parsed.success) throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid query");
    return learnerOpsData(await listKnowledge(parsed.data));
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops knowledge GET");
  }
}

export async function POST(request: Request) {
  try {
    const gate = await requireLearnerOpsStaff(["learner_ops_view", "learner_ops_admin"]);
    const parsed = knowledgeCreateSchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid body");
    return learnerOpsData(await createKnowledgeArticle({ ...parsed.data, actor: gate.actor }), 201);
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops knowledge POST");
  }
}
