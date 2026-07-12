import { NextResponse } from "next/server";
import {
  apiAuthErrorResponse,
  rateLimitedResponse,
  requireUser,
} from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { getExchangeProvider } from "@/lib/exchange";
import {
  notifyExchangeStatus,
  serializeExchangeAccount,
} from "@/lib/exchange/account";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import {
  exchangeVerifySchema,
  notFoundResponse,
  validateJsonBody,
} from "@/lib/validation";

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  let user;

  try {
    user = await requireUser();
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }

  const limit = rateLimit(`exchange:verify:${user.id}`, {
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });

  if (!limit.allowed) {
    return rateLimitedResponse();
  }

  const parsed = await validateJsonBody(request, exchangeVerifySchema);

  if (!parsed.success) {
    return parsed.response;
  }

  const account = await prisma.exchangeAccount.findUnique({
    where: { userId: user.id },
  });

  if (!account) {
    return notFoundResponse("Exchange account not found");
  }

  await createAuditLog({
    userId: user.id,
    action: "EXCHANGE_VERIFICATION_REQUESTED",
    entityType: "ExchangeAccount",
    entityId: account.id,
    metadata: { provider: account.provider },
    request,
  });

  const provider = getExchangeProvider(account.provider);
  const result = await provider.verifyConnection({
    userId: String(user.id),
    externalAccountId: account.externalAccountId ?? account.exchangeAccountId,
  });
  const now = new Date();
  const updatedAccount = await prisma.exchangeAccount.update({
    where: { id: account.id },
    data: {
      status: result.status,
      externalAccountId: result.externalAccountId ?? account.externalAccountId,
      balance: result.balance ?? account.balance,
      depositAmount: result.depositAmount ?? account.depositAmount,
      totalDeposits: result.depositAmount ?? account.totalDeposits,
      tradesCount: result.tradesCount ?? account.tradesCount,
      firstDepositConfirmed: account.firstDepositConfirmed,
      lastVerifiedAt: now,
      verifiedAt: result.status === "connected" ? now : account.verifiedAt,
      rejectionReason: result.status === "rejected" ? result.message ?? null : null,
    },
  });

  const auditAction =
    result.status === "connected" ? "EXCHANGE_CONNECTED" : "EXCHANGE_REJECTED";
  await createAuditLog({
    userId: user.id,
    action: auditAction,
    entityType: "ExchangeAccount",
    entityId: updatedAccount.id,
    metadata: {
      provider: account.provider,
      status: result.status,
      message: result.message,
    },
    request,
  });

  await notifyExchangeStatus({
    userId: user.id,
    status: updatedAccount.status,
    accountId: updatedAccount.id,
    rejectionReason: updatedAccount.rejectionReason,
    request,
  });

  return NextResponse.json({
    account: serializeExchangeAccount(updatedAccount),
  });
}
