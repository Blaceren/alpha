import { learnerOpsData, learnerOpsErrorResponse, parseJsonBody, requireLearnerOpsStaff } from "@/lib/learner-ops/http";
import { LearnerOpsError } from "@/lib/learner-ops/errors";
import { getKnowledgeArticle, updateKnowledgeArticle } from "@/lib/learner-ops/quality";
import { knowledgeUpdateSchema } from "@/lib/learner-ops/schemas";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await requireLearnerOpsStaff(["learner_ops_view"]);
    const { slug } = await params;
    return learnerOpsData(await getKnowledgeArticle(slug));
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops knowledge detail GET");
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const gate = await requireLearnerOpsStaff(["learner_ops_view", "learner_ops_admin"]);
    const { slug } = await params;
    const parsed = knowledgeUpdateSchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "invalid body");
    return learnerOpsData(await updateKnowledgeArticle({ slug, ...parsed.data, actor: gate.actor }));
  } catch (error) {
    return learnerOpsErrorResponse(error, "learner-ops knowledge PUT");
  }
}
