import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { reconcilePocketRegistrationLevelCompletion } from "@/lib/curriculum/pocket-registration-completion";
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

    // PROGRAM STRUCTURE (2026-10-02). The registration level is no longer always
    // the first one, so a learner may register while still on a lesson in front
    // of it: the postback binds the identity and completes nothing, because the
    // level is not current yet. This is where that is settled once the learner
    // stands on the level — the same idempotent reconciliation the postback
    // runs, with the same proof (the authenticated identity row) and nothing
    // taken from this request. A learner with no identity, on another level, or
    // already past it, is a no-op.
    let levelCompleted = false;
    try {
      const reconciled = await reconcilePocketRegistrationLevelCompletion(user.id);
      levelCompleted =
        reconciled.outcome === "completed" || reconciled.outcome === "already_completed";
    } catch {
      /* the confirmation stands; reconciliation is retryable */
    }

    return NextResponse.json({
      ok: true,
      status: "confirmed",
      message: "Регистрация подтверждена",
      levelCompleted,
    });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
