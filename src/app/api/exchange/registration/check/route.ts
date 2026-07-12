import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  try {
    const user = await requireUser();
    const account = await prisma.exchangeAccount.findUnique({
      where: { userId: user.id },
    });

    if (!account?.registrationStatus) {
      return NextResponse.json({
        ok: false,
        status: "pending",
        message: "Регистрация ещё не подтверждена, попробуйте позже",
      });
    }

    await createAuditLog({
      userId: user.id,
      action: "POCKET_REGISTRATION_CHECKED",
      entityType: "ExchangeAccount",
      entityId: account.id,
      metadata: { registrationStatus: account.registrationStatus },
      request,
    });

    return NextResponse.json({
      ok: true,
      status: "confirmed",
      message: "Регистрация подтверждена",
    });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
