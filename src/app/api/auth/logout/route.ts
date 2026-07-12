import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { rateLimitedResponse } from "@/lib/apiAuth";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { getRequestIp, rateLimit } from "@/lib/rateLimit";
import { SESSION_COOKIE_NAME, shouldUseSecureCookies } from "@/lib/session";

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

  const response = NextResponse.json({ ok: true });

  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: "/",
    maxAge: 0,
  });

  return response;
}
