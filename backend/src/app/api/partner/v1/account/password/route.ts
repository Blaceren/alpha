/**
 * AFFILIATE-PLATFORM-V1 §17/§44 — a partner human changes their own password.
 *
 * THE CURRENT PASSWORD IS REQUIRED. A session alone is not authority to change
 * a credential: a borrowed browser would otherwise be a permanent takeover.
 *
 * THE EPOCH IS BUMPED, so every token ever issued for this principal stops
 * verifying — including the caller's own. A NEW SESSION IS ISSUED IN THE SAME
 * RESPONSE, so the person who just changed their password stays signed in and
 * everybody else does not. That asymmetry is the whole point of the epoch.
 *
 * NO PASSWORD, OLD OR NEW, IS LOGGED, AUDITED OR ECHOED.
 */
import type { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { withPartnerRequest, partnerError, partnerJson } from "@/lib/affiliate/partner/request";
import {
  authenticatePartnerUser,
  changePartnerPassword,
  describePartnerPasswordRejection,
  hashPartnerPassword,
  PARTNER_PASSWORD_MAX_LENGTH,
  PARTNER_PASSWORD_MIN_LENGTH,
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

export const dynamic = "force-dynamic";

const schema = z.object({
  currentPassword: z.string().min(1).max(PARTNER_PASSWORD_MAX_LENGTH),
  newPassword: z.string().min(PARTNER_PASSWORD_MIN_LENGTH).max(PARTNER_PASSWORD_MAX_LENGTH),
});

export async function POST(request: Request): Promise<NextResponse> {
  return withPartnerRequest(request, async (principal) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return partnerError("invalid_request", "partner.account.invalid_request");
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return partnerError("invalid_request", "partner.account.invalid_request");
    }

    const reauth = await authenticatePartnerUser(
      principal.email,
      parsed.data.currentPassword,
      prisma,
    );
    if (reauth.kind !== "authenticated") {
      await createAuditLog({
        action: "AFFILIATE_PARTNER_PASSWORD_CHANGE_REFUSED",
        entityType: "AFFILIATE_PARTNER_USER",
        entityId: principal.partnerUserPublicId,
        request,
      });
      return partnerError("unauthorized", "partner.account.reauth_failed");
    }

    const rejection = describePartnerPasswordRejection(parsed.data.newPassword, principal.email);
    if (rejection !== null) {
      // A BOUNDED CODE, never the password and never a hint derived from it.
      return partnerError("invalid_request", `partner.account.password.${rejection}`);
    }

    const now = new Date();
    const hash = await hashPartnerPassword(parsed.data.newPassword);
    const sessionEpoch = await changePartnerPassword(prisma, {
      partnerUserId: principal.partnerUserId,
      newPasswordHash: hash,
      now,
    });

    await createAuditLog({
      action: "AFFILIATE_PARTNER_PASSWORD_CHANGED",
      entityType: "AFFILIATE_PARTNER_USER",
      entityId: principal.partnerUserPublicId,
      metadata: { affiliatePartnerId: principal.affiliatePartnerId, sessionEpoch },
      request,
    });

    const { token, expiresAt } = createPartnerSessionToken(
      { partnerUserId: principal.partnerUserId, sessionEpoch },
      now,
    );
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
  });
}
