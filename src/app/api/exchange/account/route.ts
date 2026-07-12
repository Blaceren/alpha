import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { serializeExchangeAccount } from "@/lib/exchange/account";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const account = await prisma.exchangeAccount.findUnique({
      where: { userId: user.id },
    });

    return NextResponse.json({
      account: account ? serializeExchangeAccount(account) : null,
    });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
