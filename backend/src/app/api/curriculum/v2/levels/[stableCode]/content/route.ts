import { normalizedLocaleSchema } from "@/lib/curriculum/content-schemas";
import { resolveUserLevelContent } from "@/lib/curriculum/content-read-progress";
import { gatePhase4Self, phase4Data, phase4Error, phase4Exception, strictBody, strictQuery } from "@/lib/curriculum/phase4-http";

export async function GET(request: Request, { params }: { params: Promise<{ stableCode: string }> }) {
  const gate = await gatePhase4Self(request, "content", false); if (!gate.ok) return gate.response;
  try {
    const query = strictQuery(request, ["locale"]); const locales = query.getAll("locale");
    if (locales.length !== 1) return phase4Error("INVALID_QUERY", 400);
    const locale = strictBody(normalizedLocaleSchema, locales[0]);
    const result = await resolveUserLevelContent({ actorUserId: gate.actorId, stableCode: (await params).stableCode, locale });
    if (result.kind === "available" || result.kind === "completed") return phase4Data(result);
    if (result.kind === "disabled") return phase4Error("NOT_FOUND", 404);
    if (result.kind === "user_not_found") return phase4Error("FORBIDDEN", 403);
    if (result.kind === "not_enrolled") return phase4Error("CONTENT_NOT_ENROLLED", 409);
    if (result.kind === "locked") return phase4Error("CONTENT_LEVEL_LOCKED", 409);
    if (result.kind === "unavailable") return phase4Error("CONTENT_UNAVAILABLE", 404, [{ code: result.reason }]);
    return phase4Error("CONTENT_STATE_CORRUPT", 409);
  } catch (error) { return phase4Exception(error, "self content GET"); }
}
