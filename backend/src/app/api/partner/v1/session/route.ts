/**
 * AFFILIATE-PLATFORM-V1 §17/§44 — the partner sign-in surface.
 *
 * GET    who am I            (the console's session probe)
 * POST   sign in
 * DELETE sign out
 *
 * ONE REFUSAL FOR EVERY FAILED SIGN-IN. Unknown address, wrong password,
 * disabled login and paused partner produce the same body and the same status.
 * Distinguishing them would turn this endpoint into a partner directory, and
 * would tell a dismissed employee exactly what happened to their access.
 *
 * RATE LIMITED PER IP AND PER ADDRESS, BEFORE ANY DATABASE READ. Per-IP alone
 * lets a distributed attacker spread attempts across addresses; per-address
 * alone lets one IP walk a list. The credential comparison itself is
 * constant-work regardless, so the limiter bounds volume rather than hiding
 * timing.
 *
 * THE PASSWORD IS NEVER AUDITED, LOGGED OR ECHOED. The audit rows here record
 * the partner's public id and the outcome, and a failed attempt records the
 * OUTCOME ONLY — writing the attempted address into an audit row would build a
 * searchable list of guessed partner addresses inside the database.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { getRequestIp, rateLimit } from "@/lib/rateLimit";
import {
  authenticatePartnerUser,
  normalisePartnerEmail,
} from "@/lib/affiliate/partner/credential";
import {
  PARTNER_CSRF_COOKIE_NAME,
  PARTNER_SESSION_COOKIE_NAME,
  PARTNER_SESSION_MAX_AGE_SECONDS,
  createPartnerCsrfToken,
  createPartnerSessionToken,
  partnerCsrfCookieOptions,
  partnerSessionCookieOptions,
} from "@/lib/affiliate/partner/session";
import { resolvePartnerPrincipal } from "@/lib/affiliate/partner/principal";
import {
  partnerError,
  partnerJson,
  readCookie,
} from "@/lib/affiliate/partner/request";
import { isAffiliatePlatformRequested } from "@/lib/affiliate/platform-config";

export const dynamic = "force-dynamic";

const credentialsSchema = z.object({
  email: z.string().trim().min(6).max(254),
  password: z.string().min(1).max(200),
});

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT_PER_IP = 20;
const LOGIN_LIMIT_PER_EMAIL = 8;

export async function GET(request: Request): Promise<NextResponse> {
  const token = readCookie(request, PARTNER_SESSION_COOKIE_NAME) ?? undefined;
  const auth = await resolvePartnerPrincipal(token);

  if (!auth.ok) {
    if (auth.refusal.kind === "platform_unavailable") {
      return partnerError("unavailable", "partner.platform.unavailable");
    }
    if (auth.refusal.kind === "partner_not_active") {
      return partnerError("unauthorized", "partner.session.partner_not_active", 403);
    }
    return partnerError("unauthorized", "partner.session.unauthenticated");
  }

  // EXACTLY THE FIELDS A CONSOLE NEEDS TO RENDER A HEADER. No internal ids, no
  // email of anyone else, no partner-wide configuration.
  return partnerJson({
    partnerUserId: auth.principal.partnerUserPublicId,
    email: auth.principal.email,
    displayName: auth.principal.displayName,
    partner: {
      code: auth.principal.partnerCode,
      displayName: auth.principal.partnerDisplayName,
    },
    expiresAt: auth.principal.sessionExpiresAt.toISOString(),
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAffiliatePlatformRequested()) {
    return partnerError("unavailable", "partner.platform.unavailable");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return partnerError("invalid_request", "partner.session.invalid_request");
  }

  const parsed = credentialsSchema.safeParse(body);
  if (!parsed.success) {
    return partnerError("invalid_request", "partner.session.invalid_request");
  }

  const email = normalisePartnerEmail(parsed.data.email);
  const ip = getRequestIp(request) ?? "unknown";

  // BOTH LIMITS, BEFORE ANY DATABASE WORK. A rejected attempt reads nothing.
  const byIp = rateLimit(`partner-login:ip:${ip}`, {
    limit: LOGIN_LIMIT_PER_IP,
    windowMs: LOGIN_WINDOW_MS,
  });
  const byEmail = rateLimit(`partner-login:email:${email}`, {
    limit: LOGIN_LIMIT_PER_EMAIL,
    windowMs: LOGIN_WINDOW_MS,
  });
  if (!byIp.allowed || !byEmail.allowed) {
    await createAuditLog({
      action: "AFFILIATE_PARTNER_LOGIN_RATE_LIMITED",
      entityType: "AFFILIATE_PARTNER_USER",
      request,
    });
    return partnerError("rate_limited", "partner.session.rate_limited");
  }

  const outcome = await authenticatePartnerUser(email, parsed.data.password, prisma);

  if (outcome.kind !== "authenticated") {
    // THE OUTCOME ONLY. The attempted address is deliberately NOT recorded:
    // an audit table full of guessed partner addresses is a directory an
    // attacker who later reads audit rows would thank us for.
    await createAuditLog({
      action: "AFFILIATE_PARTNER_LOGIN_REFUSED",
      entityType: "AFFILIATE_PARTNER_USER",
      request,
    });
    return partnerError("unauthorized", "partner.session.refused");
  }

  const now = new Date();
  const { token, expiresAt } = createPartnerSessionToken(
    { partnerUserId: outcome.partnerUserId, sessionEpoch: outcome.sessionEpoch },
    now,
  );

  const updated = await prisma.affiliatePartnerUser.update({
    where: { id: outcome.partnerUserId },
    data: { lastLoginAt: now },
    select: { publicId: true, affiliatePartnerId: true },
  });

  await createAuditLog({
    action: "AFFILIATE_PARTNER_LOGIN",
    entityType: "AFFILIATE_PARTNER_USER",
    entityId: updated.publicId,
    metadata: { affiliatePartnerId: updated.affiliatePartnerId },
    request,
  });

  const response = partnerJson({ ok: true, expiresAt: expiresAt.toISOString() });
  response.cookies.set(
    PARTNER_SESSION_COOKIE_NAME,
    token,
    partnerSessionCookieOptions(PARTNER_SESSION_MAX_AGE_SECONDS),
  );
  response.cookies.set(
    PARTNER_CSRF_COOKIE_NAME,
    createPartnerCsrfToken(),
    partnerCsrfCookieOptions(PARTNER_SESSION_MAX_AGE_SECONDS),
  );
  return response;
}

/**
 * Sign out.
 *
 * IT CLEARS THE COOKIES AND DOES NOT BUMP THE EPOCH. Signing out of this
 * browser must not sign the same person out of another one — that is what the
 * password-change path is for, and conflating them would make an ordinary
 * sign-out a surprise for a colleague sharing the login.
 *
 * IT SUCCEEDS EVEN WITH NO SESSION. A sign-out that errors when you are already
 * signed out is a way to leave a stale cookie in place.
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  const token = readCookie(request, PARTNER_SESSION_COOKIE_NAME) ?? undefined;
  const auth = await resolvePartnerPrincipal(token);

  if (auth.ok) {
    await createAuditLog({
      action: "AFFILIATE_PARTNER_LOGOUT",
      entityType: "AFFILIATE_PARTNER_USER",
      entityId: auth.principal.partnerUserPublicId,
      request,
    });
  }

  const response = partnerJson({ ok: true });
  response.cookies.set(PARTNER_SESSION_COOKIE_NAME, "", partnerSessionCookieOptions(0));
  response.cookies.set(PARTNER_CSRF_COOKIE_NAME, "", partnerCsrfCookieOptions(0));
  return response;
}
