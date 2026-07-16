import { z } from "zod";
import { assessmentLocaleSchema } from "@/lib/curriculum/assessment-schemas";
import { startOwnAssessmentAttempt } from "@/lib/curriculum/assessment-runtime";
import { gatePhase4Self, jsonBody, phase4Data, phase4Exception, strictBody, strictQuery } from "@/lib/curriculum/phase4-http";

const bodySchema = z.strictObject({ locale: assessmentLocaleSchema });
export async function POST(request: Request, { params }: { params: Promise<{ stableCode: string }> }) {
  const gate = await gatePhase4Self(request, "assessment", true); if (!gate.ok) return gate.response;
  try { strictQuery(request, []); const body = strictBody(bodySchema, await jsonBody(request)); return phase4Data(await startOwnAssessmentAttempt(gate.actorId, { stableCode: (await params).stableCode, locale: body.locale }), 201); }
  catch (error) { return phase4Exception(error, "assessment start POST"); }
}
