import { NextResponse } from "next/server";
import { requireUser, apiAuthErrorResponse, rateLimitedResponse } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { createEmailVerificationToken } from "@/lib/emailVerification";
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

    const token = await createEmailVerificationToken(user.id);

    await createAuditLog({
      userId: user.id,
      action: "EMAIL_VERIFICATION_RESENT",
      request,
    });

    return NextResponse.json({
      ok: true,
      devToken: process.env.NODE_ENV === "production" ? undefined : token,
    });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
