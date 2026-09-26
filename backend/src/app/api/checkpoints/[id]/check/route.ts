import { NextResponse } from "next/server";
import {
  apiAuthErrorResponse,
  forbiddenResponse,
  rateLimitedResponse,
  requireUser,
} from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import {
  checkpointCheckSchema,
  notFoundResponse,
  validateJsonBody,
  validateNumericParam,
} from "@/lib/validation";

type CheckpointCheckRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, { params }: CheckpointCheckRouteProps) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  const { id } = await params;
  const checkpointId = validateNumericParam(id, "id");

  if (!checkpointId.success) {
    await createAuditLog({
      action: "VALIDATION_ERROR",
      entityType: "API_ROUTE",
      entityId: "/api/checkpoints/[id]/check",
      metadata: { id },
      request,
    });

    return checkpointId.response;
  }

  const parsed = await validateJsonBody(request, checkpointCheckSchema);

  if (!parsed.success) {
    await createAuditLog({
      action: "VALIDATION_ERROR",
      entityType: "API_ROUTE",
      entityId: `/api/checkpoints/${checkpointId.id}/check`,
      metadata: { details: parsed.details },
      request,
    });

    return parsed.response;
  }

  let currentUser;

  try {
    currentUser = await requireUser();
  } catch (error) {
    return apiAuthErrorResponse(error);
  }

  const limit = rateLimit(`checkpoint:check:${currentUser.id}`, {
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });

  if (!limit.allowed) {
    await createAuditLog({
      userId: currentUser.id,
      action: "RATE_LIMITED",
      entityType: "API_ROUTE",
      entityId: `/api/checkpoints/${checkpointId.id}/check`,
      metadata: { resetAt: limit.resetAt },
      request,
    });

    return rateLimitedResponse();
  }

  // DEVMECH-1 — the legacy V1 financial checkpoint is RETIRED, fail-closed.
  //
  // This route used to ask a legacy balance provider for the learner's account
  // balance, persist it onto `ExchangeAccount.balance` and `Checkpoint
  // .currentBalance`, and complete the checkpoint when that number cleared a
  // threshold. Every part of that is now forbidden:
  //
  //   * it PERSISTED a current trading balance, in two places, plus a third
  //     copy in AuditLog metadata and a fourth in the notification;
  //   * it completed a financial gate from a value this platform cannot
  //     authoritatively verify, bypassing `CheckpointBalanceProvider`, which is
  //     the only sanctioned authority for "does this learner hold $50";
  //   * it trusted `ExchangeAccount.traderId`, a non-unique column overwritten
  //     by every postback goal (see PocketTraderIdentity).
  //
  // The curriculum V2 L4 checkpoint was never completable from here, and still
  // is not. The route is kept — rather than deleted — because a V1 client still
  // calls it, and a bounded, honest "unavailable" is a better answer to that
  // client than a 404 that reads as a bug.
  //
  // Nothing below this line reads a balance, writes a balance, mutates any row,
  // creates a notification, or records a financial value.
  const checkpoint = await prisma.checkpoint.findUnique({
    where: { id: checkpointId.id },
    select: { id: true, userId: true },
  });

  if (!checkpoint) {
    return notFoundResponse();
  }

  if (checkpoint.userId !== currentUser.id) {
    return forbiddenResponse();
  }

  // Bounded, non-financial: an operator can see that a retired path was called,
  // and nothing else. No balance, no threshold, no provider result.
  await createAuditLog({
    userId: currentUser.id,
    action: "CHECKPOINT_CHECK_REFUSED",
    entityType: "Checkpoint",
    entityId: checkpoint.id,
    metadata: { reason: "legacy_balance_verification_retired" },
    request,
  });

  return NextResponse.json(
    {
      error: "CHECKPOINT_VERIFICATION_UNAVAILABLE",
      message:
        "Проверка баланса по этому маршруту больше не выполняется. Финансовая контрольная точка проверяется только авторизованным поставщиком баланса.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
