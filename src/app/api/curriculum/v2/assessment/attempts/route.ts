import { resolveOwnAssessmentAttemptHistory } from "@/lib/curriculum/assessment-history";
import { gatePhase4Self, phase4Data, phase4Exception, Phase4HttpError, strictQuery } from "@/lib/curriculum/phase4-http";

export async function GET(request: Request) {
  const gate = await gatePhase4Self(request, "assessment", false); if (!gate.ok) return gate.response;
  try {
    const query = strictQuery(request, ["limit", "cursor"]);
    if (query.getAll("limit").length > 1 || query.getAll("cursor").length > 1) throw new Phase4HttpError("INVALID_QUERY", 400);
    const rawLimit = query.get("limit"); const limit = rawLimit === null ? 20 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Phase4HttpError("INVALID_QUERY", 400);
    const cursor = query.get("cursor") ?? undefined;
    return phase4Data(await resolveOwnAssessmentAttemptHistory({ actorUserId: gate.actorId, limit, cursor }));
  } catch (error) { return phase4Exception(error, "assessment history GET"); }
}
