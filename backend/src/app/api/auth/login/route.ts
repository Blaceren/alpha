import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { toPublicUser } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { rateLimitedResponse } from "@/lib/apiAuth";
import { verifyCaptcha } from "@/lib/captcha";
import { resolveAuthSurface } from "@/lib/captcha/surface";
import { isEmailVerificationRequired } from "@/lib/emailVerification";
import { prisma } from "@/lib/prisma";
import { getRequestIp, rateLimit } from "@/lib/rateLimit";
import {
  issueSession,
  LEGACY_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  clearedLegacySessionCookieOptions,
  sessionCookieOptions,
} from "@/lib/session";
import { loginSchema, validateJsonBody } from "@/lib/validation";

export async function POST(request: Request) {
  const parsed = await validateJsonBody(request, loginSchema);
  const email = parsed.success ? parsed.data.email : "invalid-email";
  const ip = getRequestIp(request);
  const limit = rateLimit(`auth:login:${ip}:${email}`, {
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });

  if (!limit.allowed) {
    await createAuditLog({
      action: "RATE_LIMITED",
      entityType: "API_ROUTE",
      entityId: "/api/auth/login",
      metadata: { email, resetAt: limit.resetAt },
      request,
    });

    return rateLimitedResponse();
  }

  if (!parsed.success) {
    await createAuditLog({
      action: "VALIDATION_ERROR",
      entityType: "API_ROUTE",
      entityId: "/api/auth/login",
      metadata: { email, details: parsed.details },
      request,
    });

    return parsed.response;
  }

  // AFD-3A3: which login form is this? The Academy proxy and the CRM login
  // route each stamp their own surface header; a browser cannot, because both
  // build their outbound headers from an allow-list this name is not in and then
  // `set` it themselves. An unresolved surface is refused inside `verifyCaptcha`
  // rather than defaulting to either frontend.
  const surface = resolveAuthSurface(request, "login");

  const captcha = await verifyCaptcha({
    token: parsed.data.captchaToken,
    purpose: "login",
    surface,
    request,
  });

  if (!captcha.ok) {
    // AFD-3A2: the code and status come from the shared CAPTCHA outcome
    // contract, so a provider outage reads as 503 CAPTCHA_UNAVAILABLE instead of
    // accusing the person at the keyboard of failing a challenge that never ran.
    // On an `ATA_ENVIRONMENT=dev` deployment without login enforcement this
    // branch is unreachable, exactly as before — see src/lib/captcha.ts.
    //
    // AFD-3A3: recorded, and recorded BEFORE any password comparison. Nothing
    // below this line runs, so a failed challenge cannot be used as a password
    // oracle — the response is identical whether or not the email exists. The
    // surface name is a bounded internal constant; the token is not recorded
    // here or anywhere else.
    await createAuditLog({
      action: "CAPTCHA_REJECTED",
      entityType: "API_ROUTE",
      entityId: "/api/auth/login",
      metadata: {
        email,
        outcome: captcha.outcome,
        code: captcha.code,
        surface: surface?.name ?? null,
      },
      request,
    });

    return NextResponse.json(
      { error: captcha.code, message: captcha.message },
      { status: captcha.status },
    );
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });

  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    await createAuditLog({
      userId: user?.id,
      action: "AUTH_LOGIN_FAILED",
      metadata: { email: parsed.data.email, reason: "invalid_credentials" },
      request,
    });

    return NextResponse.json(
      { error: "Неверный email или пароль" },
      { status: 401 },
    );
  }

  if (user.status === "blocked") {
    await createAuditLog({
      userId: user.id,
      action: "AUTH_LOGIN_BLOCKED",
      metadata: { email: parsed.data.email },
      request,
    });

    return NextResponse.json(
      { error: "ACCOUNT_BLOCKED", message: "Аккаунт заблокирован" },
      { status: 403 },
    );
  }

  if (isEmailVerificationRequired() && !user.emailVerifiedAt) {
    await createAuditLog({
      userId: user.id,
      action: "AUTH_LOGIN_FAILED",
      metadata: { email: parsed.data.email, reason: "email_not_verified" },
      request,
    });

    return NextResponse.json(
      { error: "EMAIL_NOT_VERIFIED", message: "Подтвердите email перед входом" },
      { status: 403 },
    );
  }

  await createAuditLog({
    userId: user.id,
    action: "AUTH_LOGIN",
    metadata: { email: parsed.data.email },
    request,
  });

  const response = NextResponse.json({ user: toPublicUser(user) });
  /* Issuing revokes whatever this user had, in one transaction, so a second
     login ends the first session rather than running alongside it (H-7). */
  response.cookies.set(SESSION_COOKIE_NAME, await issueSession(user.id), sessionCookieOptions);
  /* And expire the pre-`__Host-` cookie, so a browser holding one stops sending
     a value nothing will ever accept. Its value is never read. */
  response.cookies.set(LEGACY_SESSION_COOKIE_NAME, "", clearedLegacySessionCookieOptions);

  return response;
}
