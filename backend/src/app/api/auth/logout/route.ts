import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { rateLimitedResponse } from "@/lib/apiAuth";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { getRequestIp, rateLimit } from "@/lib/rateLimit";
import {
  LEGACY_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  clearedLegacySessionCookieOptions,
  clearedSessionCookieOptions,
  readSessionToken,
  revokeSession,
} from "@/lib/session";

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  const user = await getCurrentUser();
  const ip = getRequestIp(request);
  const limit = rateLimit(`auth:logout:${ip}`, {
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });

  if (!limit.allowed) {
    await createAuditLog({
      userId: user?.id,
      action: "RATE_LIMITED",
      entityType: "API_ROUTE",
      entityId: "/api/auth/logout",
      metadata: { resetAt: limit.resetAt },
      request,
    });

    return rateLimitedResponse();
  }

  await createAuditLog({
    userId: user?.id,
    action: "AUTH_LOGOUT",
    metadata: user ? { email: user.email } : null,
    request,
  });

  const sessionToken = await readSessionToken();
  const response = NextResponse.json({ ok: true });

  /* REVOKE FIRST, THEN CLEAR. Clearing the cookie only stops this browser from
     sending the token; revoking is what stops the token working at all, which
     is the whole point of H-7. Idempotent: logging out twice, or with an
     already-dead token, is a no-op that still reports success. */
  await revokeSession(sessionToken);
  response.cookies.set(SESSION_COOKIE_NAME, "", clearedSessionCookieOptions);
  response.cookies.set(LEGACY_SESSION_COOKIE_NAME, "", clearedLegacySessionCookieOptions);

  return response;
}
