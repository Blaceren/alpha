import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  apiAuthErrorResponse,
  rateLimitedResponse,
  requireUser,
} from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { createNotification } from "@/lib/notifications";
import {
  isPromocodeRedemptionError,
  type PromocodeRedemptionErrorCode,
  redeemPromocode,
} from "@/lib/promocodes/redemption";
import { rateLimit } from "@/lib/rateLimit";
import { validateJsonBody, validationErrorResponse } from "@/lib/validation";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const redeemSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(50)
      .transform((value) => value.toUpperCase()),
  })
  .strict();

const rejectedAuditCodes = new Set<PromocodeRedemptionErrorCode>([
  "PROMOCODE_NOT_FOUND",
  "PROMOCODE_INACTIVE",
  "PROMOCODE_EXPIRED",
  "PROMOCODE_MAX_USES_REACHED",
]);

function responseHeaders(requestId?: string) {
  return {
    "Cache-Control": "no-store",
    ...(requestId ? { "Idempotency-Key": requestId } : {}),
  };
}

function errorStatus(code: PromocodeRedemptionErrorCode) {
  if (code === "PROMOCODE_INPUT_INVALID") return 400;
  if (
    code === "PROMOCODE_NOT_FOUND" ||
    code === "PROMOCODE_INACTIVE" ||
    code === "PROMOCODE_EXPIRED" ||
    code === "PROMOCODE_MAX_USES_REACHED" ||
    code === "PROMOCODE_USER_LIMIT_REACHED"
  ) {
    return 422;
  }
  if (
    code === "PROMOCODE_IDEMPOTENCY_CONFLICT" ||
    code === "PROMOCODE_STATE_CORRUPT" ||
    code === "PROMOCODE_CONCURRENCY_RETRY_EXHAUSTED" ||
    code === "PROMOCODE_V2_STATE_CORRUPT"
  ) {
    return 409;
  }
  return 500;
}

function publicMessage(code: PromocodeRedemptionErrorCode) {
  if (code === "PROMOCODE_USER_LIMIT_REACHED") {
    return "Promocode user limit reached";
  }
  if (code === "PROMOCODE_MAX_USES_REACHED") {
    return "Promocode global limit reached";
  }
  if (
    code === "PROMOCODE_NOT_FOUND" ||
    code === "PROMOCODE_INACTIVE" ||
    code === "PROMOCODE_EXPIRED"
  ) {
    return "Promocode is unavailable";
  }
  if (code === "PROMOCODE_INPUT_INVALID") return "Invalid promocode request";
  if (code === "PROMOCODE_IDEMPOTENCY_CONFLICT") {
    return "Promocode request identity conflict";
  }
  if (errorStatus(code) === 409) return "Promocode state conflict";
  return "Promocode redemption failed";
}

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }

  const limit = rateLimit(`promocode:redeem:${user.id}`, {
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!limit.allowed) return rateLimitedResponse();

  if (!validateCsrfToken(request)) return csrfFailureResponse(request);

  const providedRequestId = request.headers.get("Idempotency-Key");
  if (
    providedRequestId !== null &&
    !REQUEST_ID_PATTERN.test(providedRequestId)
  ) {
    return validationErrorResponse([
      { field: "Idempotency-Key", message: "Invalid request identity" },
    ]);
  }
  const requestId = providedRequestId ?? randomUUID();

  const parsed = await validateJsonBody(request, redeemSchema);
  if (!parsed.success) return parsed.response;

  try {
    const result = await redeemPromocode({
      userId: user.id,
      code: parsed.data.code,
      requestId,
    });

    if (result.created) {
      await createAuditLog({
        userId: user.id,
        action: "PROMOCODE_REDEEMED",
        entityType: "Promocode",
        entityId: result.promocode.id,
        metadata: {
          code: result.promocode.code,
          type: result.promocode.type,
          redemptionId: result.redemptionId,
        },
        request,
      });
      await createNotification({
        userId: user.id,
        type: "promocode_redeemed",
        title: "Promocode redeemed",
        message: `Promocode ${result.promocode.code} was redeemed successfully.`,
        metadata: { promocodeId: result.promocode.id },
        request,
      });
    }

    return NextResponse.json(
      {
        ok: true,
        created: result.created,
        requestId: result.requestId,
        redemptionId: result.redemptionId,
        xpAwarded: result.xpAwarded,
        v2XpTransactionId: result.v2XpTransactionId,
        promocode: result.promocode,
      },
      { headers: responseHeaders(result.requestId) },
    );
  } catch (error) {
    if (!isPromocodeRedemptionError(error)) {
      return NextResponse.json(
        { error: "PROMOCODE_INTERNAL_ERROR", message: "Promocode redemption failed" },
        { status: 500, headers: responseHeaders(requestId) },
      );
    }

    if (rejectedAuditCodes.has(error.code)) {
      await createAuditLog({
        userId: user.id,
        action: "PROMOCODE_REJECTED",
        metadata: { code: parsed.data.code, reason: error.code },
        request,
      });
    }
    return NextResponse.json(
      { error: error.code, message: publicMessage(error.code) },
      { status: errorStatus(error.code), headers: responseHeaders(requestId) },
    );
  }
}
