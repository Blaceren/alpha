import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { toPublicUser } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { rateLimitedResponse } from "@/lib/apiAuth";
import { verifyCaptcha } from "@/lib/captcha";
import { resolveAuthSurface } from "@/lib/captcha/surface";
import { isCrmStaffRole } from "@/lib/crm/roles";
import { isEmailVerificationRequired } from "@/lib/emailVerification";
import { prisma } from "@/lib/prisma";
import { clearRateLimit, getRequestIp, peekRateLimit, rateLimit } from "@/lib/rateLimit";
import {
  issueSession,
  LEGACY_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SessionIssueRefusedError,
  clearedLegacySessionCookieOptions,
  readSessionToken,
  sessionCookieOptions,
} from "@/lib/session";
import { loginSchema, validateJsonBody } from "@/lib/validation";

/* WRONG PASSWORDS ARE WHAT IS COUNTED (2026-10-07 audit). The limit used to
   count every request for an address and email, sign-ins that succeeded
   included and requests that never passed the challenge, so a learner who
   signed in five times in ten minutes was refused the sixth with the right
   password, and anyone behind the same address could spend the five without
   solving anything. Now: a key at its limit is refused BEFORE the challenge
   (the token stays unspent); only a wrong password, which needed a solved
   challenge to be tried, adds to it; the right password clears it. nginx keeps
   its own per-address limit on the auth routes. */
const LOGIN_FAILURE_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 };

/* AN ANSWER THAT TAKES THE SAME TIME (2026-10-07 audit). bcrypt ran only when
   the address existed, so an unknown address answered measurably faster than a
   known one. Without an account the password is compared with this hash —
   same cost as the stored ones (10) — and the result is ignored. */
let timingEqualizer: string | null = null;
async function spendComparisonTime(password: string) {
  timingEqualizer ??= await bcrypt.hash("ata-timing-equalizer", 10);
  await bcrypt.compare(password, timingEqualizer);
}

function invalidCredentials() {
  return NextResponse.json(
    { error: "Неверный email или пароль" },
    { status: 401 },
  );
}

export async function POST(request: Request) {
  const parsed = await validateJsonBody(request, loginSchema);

  if (!parsed.success) {
    await createAuditLog({
      action: "VALIDATION_ERROR",
      entityType: "API_ROUTE",
      entityId: "/api/auth/login",
      metadata: { email: "invalid-email", details: parsed.details },
      request,
    });

    return parsed.response;
  }

  const email = parsed.data.email;
  const ip = getRequestIp(request);
  const failureKey = `auth:login:${ip}:${email}`;
  const limit = peekRateLimit(failureKey, LOGIN_FAILURE_LIMIT);

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

  if (!user) await spendComparisonTime(parsed.data.password);

  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    rateLimit(failureKey, LOGIN_FAILURE_LIMIT);
    await createAuditLog({
      userId: user?.id,
      action: "AUTH_LOGIN_FAILED",
      metadata: { email: parsed.data.email, reason: "invalid_credentials" },
      request,
    });

    return invalidCredentials();
  }

  clearRateLimit(failureKey);

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

  /* THE CRM'S FORM SIGNS IN STAFF ONLY (2026-10-07 audit). The CRM used to
     learn that an account was not staff only after this route had issued it a
     session, and then dropped the cookie: a session nobody held, taking one of
     the account's two places — closing the learner's other device to make room
     — and listed in «Сеансы» as an unknown device for a week. The decision is
     taken here now, before anything is issued, by the same rule the CRM session
     applies (a StaffProfile with a known staff role). */
  if (surface?.name === "crm_login") {
    const profile = await prisma.staffProfile.findUnique({
      where: { userId: user.id },
      select: { staffRole: true },
    });
    if (!profile || !isCrmStaffRole(profile.staffRole)) {
      await createAuditLog({
        userId: user.id,
        action: "AUTH_LOGIN_FAILED",
        metadata: { email: parsed.data.email, reason: "not_staff" },
        request,
      });

      return NextResponse.json(
        { error: "NOT_STAFF", message: "У этого аккаунта нет доступа к CRM" },
        { status: 403 },
      );
    }
  }

  /* A sign-in takes one of the account's two places (owner 2026-10-07); with
     both taken it closes the session unused the longest, in the same
     transaction, and that is recorded. The session this browser still presents
     is closed first, so signing in again on one device never closes the other
     (2026-10-07 audit); and the password is re-read in that transaction, so a
     change that landed after the check above issues nothing. The browser's own
     description is kept only to name the device in the learner's list of
     sessions. */
  const evicted: { sessionId: string | null } = { sessionId: null };
  let token: string;
  try {
    token = await issueSession(user.id, {
      userAgent: request.headers.get("user-agent"),
      replacing: await readSessionToken(),
      expectedPasswordHash: user.passwordHash,
      onEvicted: (sessionId) => {
        evicted.sessionId = sessionId;
      },
    });
  } catch (error) {
    if (!(error instanceof SessionIssueRefusedError)) throw error;
    await createAuditLog({
      userId: user.id,
      action: "AUTH_LOGIN_FAILED",
      metadata: { email: parsed.data.email, reason: "account_changed" },
      request,
    });
    return invalidCredentials();
  }

  await createAuditLog({
    userId: user.id,
    action: "AUTH_LOGIN",
    metadata: { email: parsed.data.email },
    request,
  });

  const response = NextResponse.json({ user: toPublicUser(user) });
  if (evicted.sessionId) {
    await createAuditLog({
      userId: user.id,
      action: "AUTH_SESSION_EVICTED",
      entityType: "UserSession",
      entityId: evicted.sessionId,
      request,
    });
  }
  response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions);
  /* And expire the pre-`__Host-` cookie, so a browser holding one stops sending
     a value nothing will ever accept. Its value is never read. */
  response.cookies.set(LEGACY_SESSION_COOKIE_NAME, "", clearedLegacySessionCookieOptions);

  return response;
}
