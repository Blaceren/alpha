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
import { resolveFirstDepositConfirmation } from "@/lib/exchange/first-deposit-truth";

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
      // DEVMECH-1: a current trading balance is never persisted. The
      // legacy provider may report one; it is discarded here rather than
      // written, because the only sanctioned authority for a financial
      // gate is CheckpointBalanceProvider, which returns a verdict and
      // never an amount. Historical deposit accounting is unaffected.
      depositAmount: result.depositAmount ?? account.depositAmount,
      totalDeposits: result.depositAmount ?? account.totalDeposits,
      tradesCount: result.tradesCount ?? account.tradesCount,
      // FDCONF-1: the redundant self-write of the legacy column is removed. It
      // wrote the value back unchanged, so it changed nothing — but it kept this
      // route in the set of places that read it, and an edit that turned it into
      // `result.something ?? account.firstDepositConfirmed` would have handed a
      // remote provider response authority over a learner's first deposit.
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
    account: serializeExchangeAccount(
      updatedAccount,
      await resolveFirstDepositConfirmation(prisma, user.id),
    ),
  });
}
