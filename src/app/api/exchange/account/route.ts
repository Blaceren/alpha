import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { serializeExchangeAccount } from "@/lib/exchange/account";
import { resolveFirstDepositConfirmation } from "@/lib/exchange/first-deposit-truth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const account = await prisma.exchangeAccount.findUnique({
      where: { userId: user.id },
    });
    const firstDeposit = await resolveFirstDepositConfirmation(prisma, user.id);

    return NextResponse.json({
      account: account ? serializeExchangeAccount(account, firstDeposit) : null,
    });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
