import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireAdmin } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import {
  notifyExchangeStatus,
  serializeExchangeAccount,
} from "@/lib/exchange/account";
import { prisma } from "@/lib/prisma";
import {
  adminExchangeAccountUpdateSchema,
  notFoundResponse,
  validateJsonBody,
  validateNumericParam,
} from "@/lib/validation";
import { resolveFirstDepositConfirmation } from "@/lib/exchange/first-deposit-truth";

type AdminExchangeAccountRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  request: Request,
  { params }: AdminExchangeAccountRouteProps,
) {
  try {
    await requireAdmin();
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }

  const { id } = await params;
  const accountId = validateNumericParam(id, "id");

  if (!accountId.success) {
    return accountId.response;
  }

  const account = await prisma.exchangeAccount.findUnique({
    where: { id: accountId.id },
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
      postbackEvents: {
        orderBy: { createdAt: "desc" },
        take: 25,
      },
    },
  });

  if (!account) {
    return notFoundResponse("Exchange account not found");
  }

  return NextResponse.json({
    account: serializeExchangeAccount(
      account,
      await resolveFirstDepositConfirmation(prisma, account.userId),
    ),
    postbackEvents: account.postbackEvents,
  });
}

export async function PATCH(
  request: Request,
  { params }: AdminExchangeAccountRouteProps,
) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  let adminUser;

  try {
    adminUser = await requireAdmin();
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }

  const { id } = await params;
  const accountId = validateNumericParam(id, "id");

  if (!accountId.success) {
    return accountId.response;
  }

  const parsed = await validateJsonBody(request, adminExchangeAccountUpdateSchema);

  if (!parsed.success) {
    return parsed.response;
  }

  const existingAccount = await prisma.exchangeAccount.findUnique({
    where: { id: accountId.id },
  });

  if (!existingAccount) {
    return notFoundResponse("Exchange account not found");
  }

  const status = parsed.data.status;
  const updatedAccount = await prisma.exchangeAccount.update({
    where: { id: accountId.id },
    data: {
      ...parsed.data,
      // FDCONF-1 — THE INFERENCE THAT WAS HERE IS REMOVED.
      //
      // This route previously wrote
      //     firstDepositConfirmed: parsed.data.depositAmount > 0
      // so an administrator correcting a deposit TOTAL silently asserted that a
      // first deposit had been confirmed. That is inference from cumulative
      // deposits without canonical event authority — the precise thing the
      // first-deposit truth contract forbids, and a staff-reachable way to grow
      // the legacy set behind the canonical ledger's back.
      //
      // Nothing replaces it. Whether a learner has a first deposit is answered
      // by `resolveFirstDepositConfirmation` from the canonical conversion
      // ledger; it is not an editable field, and an admin form is not an
      // authority on whether money arrived.
      verifiedAt:
        status === "connected" && existingAccount.verifiedAt === null
          ? new Date()
          : undefined,
    },
  });

  await createAuditLog({
    userId: adminUser.id,
    action: "ADMIN_EXCHANGE_ACCOUNT_UPDATED",
    entityType: "ExchangeAccount",
    entityId: updatedAccount.id,
    metadata: {
      before: {
        status: existingAccount.status,
        // DEVMECH-1: no current trading balance in audit metadata.
        depositAmount: existingAccount.depositAmount,
        tradesCount: existingAccount.tradesCount,
      },
      after: parsed.data,
    },
    request,
  });

  const statusActionByStatus: Record<string, string | undefined> = {
    connected: "ADMIN_EXCHANGE_ACCOUNT_CONNECTED",
    rejected: "ADMIN_EXCHANGE_ACCOUNT_REJECTED",
    blocked: "ADMIN_EXCHANGE_ACCOUNT_BLOCKED",
  };
  const statusAction = status ? statusActionByStatus[status] : undefined;

  if (statusAction && status !== existingAccount.status) {
    await createAuditLog({
      userId: adminUser.id,
      action: statusAction,
      entityType: "ExchangeAccount",
      entityId: updatedAccount.id,
      metadata: {
        status,
        rejectionReason: updatedAccount.rejectionReason,
      },
      request,
    });

    await notifyExchangeStatus({
      userId: updatedAccount.userId,
      status: status!,
      accountId: updatedAccount.id,
      rejectionReason: updatedAccount.rejectionReason,
      request,
    });
  }

  return NextResponse.json({
    account: serializeExchangeAccount(
      updatedAccount,
      await resolveFirstDepositConfirmation(prisma, updatedAccount.userId),
    ),
  });
}
