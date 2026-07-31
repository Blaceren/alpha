import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { toPublicUser } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { rateLimitedResponse } from "@/lib/apiAuth";
import { verifyCaptcha } from "@/lib/captcha";
import { isEmailVerificationRequired } from "@/lib/emailVerification";
import { prisma } from "@/lib/prisma";
import { getRequestIp, rateLimit } from "@/lib/rateLimit";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
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

  const captcha = await verifyCaptcha({
    token: parsed.data.captchaToken,
    purpose: "login",
    request,
  });

  if (!captcha.ok) {
    // AFD-3A2: the code and status now come from the shared CAPTCHA outcome
    // contract, so a provider outage reads as 503 CAPTCHA_UNAVAILABLE instead of
    // accusing the person at the keyboard of failing a challenge that never ran.
    // On an `ATA_ENVIRONMENT=dev` deployment without login enforcement this
    // branch is unreachable, exactly as before — see src/lib/captcha.ts.
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
  response.cookies.set(
    SESSION_COOKIE_NAME,
    createSessionToken(user.id, user.role),
    sessionCookieOptions,
  );

  return response;
}
