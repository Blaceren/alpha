import { forbiddenResponse } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { getPostbackSecret } from "@/lib/env";
import { processExchangePostbackPayload } from "@/lib/exchange/postbackProcessor";
import { receivePostbackSchema, validateJsonBody } from "@/lib/validation";

export async function POST(request: Request) {
  const secret = request.headers.get("x-postback-secret");

  if (secret !== getPostbackSecret()) {
    await createAuditLog({
      action: "POSTBACK_FORBIDDEN",
      entityType: "API_ROUTE",
      entityId: "/api/exchange/postbacks/receive",
      request,
    });

    return forbiddenResponse();
  }

  const parsed = await validateJsonBody(request, receivePostbackSchema);

  if (!parsed.success) {
    await createAuditLog({
      action: "VALIDATION_ERROR",
      entityType: "API_ROUTE",
      entityId: "/api/exchange/postbacks/receive",
      metadata: { details: parsed.details },
      request,
    });

    return parsed.response;
  }

  return processExchangePostbackPayload(parsed.data, request);
}
