import { NextResponse } from "next/server";
import {
  apiAuthErrorResponse,
  rateLimitedResponse,
  requireUser,
} from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { parseExchangeProviderId } from "@/lib/exchange";
import { serializeExchangeAccount } from "@/lib/exchange/account";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { exchangeConnectSchema, validateJsonBody } from "@/lib/validation";
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

  const limit = rateLimit(`exchange:connect:${user.id}`, {
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });

  if (!limit.allowed) {
    return rateLimitedResponse();
  }

  const parsed = await validateJsonBody(request, exchangeConnectSchema);

  if (!parsed.success) {
    await createAuditLog({
      userId: user.id,
      action: "VALIDATION_ERROR",
      entityType: "API_ROUTE",
      entityId: "/api/exchange/connect",
      metadata: { details: parsed.details },
      request,
    });

    return parsed.response;
  }

  const provider = parseExchangeProviderId(parsed.data.provider);
  const externalAccountId = parsed.data.externalAccountId?.trim() || null;
  const accountIdentifier = externalAccountId || `email:${parsed.data.email}`;

  const account = await prisma.exchangeAccount.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      provider,
      referralLink: `https://exchange.example/ref/user-${user.id}`,
      exchangeAccountId: accountIdentifier,
      externalAccountId,
      status: "pending",
      rejectionReason: null,
    },
    update: {
      provider,
      exchangeAccountId: accountIdentifier,
      externalAccountId,
      traderId: null,
      clickId: null,
      attribution: {},
      status: "pending",
      registrationStatus: false,
      emailConfirmed: false,
      firstDepositConfirmed: false,
      balance: 0,
      depositAmount: 0,
      totalDeposits: 0,
      totalWithdrawals: 0,
      totalCommission: 0,
      tradesCount: 0,
      rejectionReason: null,
      lastVerifiedAt: null,
    },
  });

  await createAuditLog({
    userId: user.id,
    action: "EXCHANGE_CONNECT_REQUESTED",
    entityType: "ExchangeAccount",
    entityId: account.id,
    metadata: {
      provider,
      hasExternalAccountId: Boolean(externalAccountId),
      hasEmail: Boolean(parsed.data.email),
    },
    request,
  });

  return NextResponse.json({
    account: serializeExchangeAccount(
      account,
      await resolveFirstDepositConfirmation(prisma, account.userId),
    ),
  });
}
