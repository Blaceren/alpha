import { NextResponse } from "next/server";
import { requireUser, apiAuthErrorResponse, rateLimitedResponse } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { accountCapabilities } from "@/lib/account/capabilities";
import { sendVerificationMail } from "@/lib/account/emailChange";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);

  try {
    const user = await requireUser();
    const limit = rateLimit(`auth:resend-verification:${user.id}`, {
      limit: 3,
      windowMs: 30 * 60 * 1000,
    });
    if (!limit.allowed) return rateLimitedResponse();

    if (user.emailVerifiedAt) {
      return NextResponse.json({ ok: true, alreadyVerified: true });
    }

    /* A confirmation is a message. Where no message can be sent there is
       nothing to resend, and saying "ok" would leave the person waiting. */
    if (!accountCapabilities().emailVerification) {
      return NextResponse.json(
        { error: "VERIFICATION_UNAVAILABLE", message: "Подтверждение почты сейчас недоступно." },
        { status: 503 },
      );
    }

    const account = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, name: true },
    });
    const result = account ? await sendVerificationMail(account) : { sent: false as const };

    await createAuditLog({
      userId: user.id,
      action: "EMAIL_VERIFICATION_RESENT",
      request,
    });

    return NextResponse.json({ ok: true, sent: result.sent });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
