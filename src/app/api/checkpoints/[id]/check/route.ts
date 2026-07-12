import { NextResponse } from "next/server";
import {
  apiAuthErrorResponse,
  forbiddenResponse,
  rateLimitedResponse,
  requireUser,
} from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { getBalanceProvider } from "@/lib/exchange/balanceProvider";
import { createCheckpointNotification } from "@/lib/notifications";
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

  const checkpoint = await prisma.checkpoint.findUnique({
    where: { id: checkpointId.id },
    include: {
      user: {
        include: {
          exchangeAccount: true,
        },
      },
    },
  });

  if (!checkpoint) {
    return notFoundResponse();
  }

  if (checkpoint.userId !== currentUser.id) {
    return forbiddenResponse();
  }

  const exchangeAccount = checkpoint.user?.exchangeAccount;
  if (!exchangeAccount?.traderId) {
    return NextResponse.json(
      { error: "TRADER_ID_REQUIRED", message: "Для проверки контрольной точки нужен trader_id из Pocket postback." },
      { status: 400 },
    );
  }
  const provider = getBalanceProvider(exchangeAccount?.provider);
  const providerResult = await provider.verifyCheckpoint(currentUser.id, checkpoint.requiredBalance);
  const nextBalance = providerResult.balance ?? exchangeAccount?.balance ?? checkpoint.currentBalance;
  const nextStatus = providerResult.ok && nextBalance >= checkpoint.requiredBalance ? "completed" : "frozen";
  const progressStatus = nextStatus === "frozen" ? "frozen" : "active";

  const updatedCheckpoint = await prisma.$transaction(async (tx) => {
    if (checkpoint.user?.exchangeAccount && typeof providerResult.balance === "number") {
      await tx.exchangeAccount.update({
        where: { id: checkpoint.user.exchangeAccount.id },
        data: { balance: nextBalance, lastVerifiedAt: new Date() },
      });
    }

    return tx.checkpoint.update({
      where: { id: checkpointId.id },
      data: {
        currentBalance: nextBalance,
        status: nextStatus,
      },
    });
  });

  await createAuditLog({
    userId: currentUser.id,
    action: "CHECKPOINT_CHECKED",
    entityType: "Checkpoint",
    entityId: updatedCheckpoint.id,
    metadata: {
      requiredBalance: updatedCheckpoint.requiredBalance,
      currentBalance: updatedCheckpoint.currentBalance,
      status: updatedCheckpoint.status,
      progressStatus,
      provider: provider.id,
      providerMessage: providerResult.message,
    },
    request,
  });

  if (
    (updatedCheckpoint.status === "frozen" ||
      updatedCheckpoint.status === "completed") &&
    updatedCheckpoint.status !== checkpoint.status
  ) {
    await createCheckpointNotification({
      userId: currentUser.id,
      status: updatedCheckpoint.status,
      checkpointId: updatedCheckpoint.id,
      currentBalance: updatedCheckpoint.currentBalance,
      requiredBalance: updatedCheckpoint.requiredBalance,
      request,
    });
  }

  return NextResponse.json({
    checkpoint: updatedCheckpoint,
    progressStatus,
    provider: provider.id,
    message: providerResult.message,
  });
}
