/**
 * AFFILIATE-PLATFORM-V1 §17/§18 — WHO is making this request, and WHICH TENANT
 * they are.
 *
 * THIS MODULE IS THE ONLY SOURCE OF A PARTNER ID FOR ANY QUERY IN THE PLATFORM.
 * Not a path parameter, not a body field, not a query string, not a header.
 * `resolvePartnerPrincipal` returns `affiliatePartnerId` read from the database
 * row the SESSION names, and every partner-scoped owner takes that value as its
 * tenant. A route that accepted a partner id from the request would be one
 * typo away from horizontal IDOR, so no route is given the opportunity: the
 * partner-facing owners in this platform do not have a partner-id parameter to
 * pass the wrong thing to.
 *
 * FOUR INDEPENDENT REASONS TO REFUSE, and they are checked in this order:
 *   1. the platform is disabled                       -> 503
 *   2. the token is absent, forged, malformed, expired -> 401
 *   3. the principal is missing, disabled, or its epoch is stale -> 401
 *   4. the PARTNER is paused or archived               -> 403
 *
 * (3) AND (4) ARE DIFFERENT FACTS AND GET DIFFERENT ANSWERS. "Your login was
 * revoked" and "your company's account is paused" are not the same event, and
 * an operator reading a support ticket needs to know which happened. Neither
 * response ever states which — both are bounded codes — but the audit trail
 * and the status code differ.
 *
 * A DISABLED PARTNER LOSES ACCESS AND LOSES NOTHING ELSE. §43: pausing a
 * partner must not erase historical attribution, conversions or earned
 * commission. This module is the whole of what "disable" does at runtime —
 * it stops sessions. It touches no ledger row and no money.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  isAffiliatePlatformRequested,
  resolvePartnerPlatformConfig,
} from "@/lib/affiliate/platform-config";
import { verifyPartnerSessionToken } from "@/lib/affiliate/partner/session";

type Db = PrismaClient | Prisma.TransactionClient;

export type PartnerPrincipal = {
  /** The DATABASE id of the human. Never exposed by any response. */
  readonly partnerUserId: number;
  /** The opaque id a response may carry. */
  readonly partnerUserPublicId: string;
  readonly email: string;
  readonly displayName: string;
  /**
   * THE TENANT. Every partner-scoped query in the platform is filtered on this
   * value and on nothing a request supplied.
   */
  readonly affiliatePartnerId: number;
  readonly partnerCode: string;
  readonly partnerDisplayName: string;
  readonly sessionExpiresAt: Date;
};

export type PartnerAuthRefusal =
  /** The platform is switched off, or its secret is unusable. */
  | { readonly kind: "platform_unavailable"; readonly status: 503 }
  /** No usable session: absent, forged, expired, revoked, or principal gone. */
  | { readonly kind: "unauthenticated"; readonly status: 401 }
  /** A valid principal whose PARTNER may not currently be used. */
  | { readonly kind: "partner_not_active"; readonly status: 403 };

export type PartnerAuthResult =
  | { readonly ok: true; readonly principal: PartnerPrincipal }
  | { readonly ok: false; readonly refusal: PartnerAuthRefusal };

/**
 * Resolve the principal from a raw cookie value.
 *
 * THE DATABASE IS CONSULTED ON EVERY REQUEST, deliberately. A stateless token
 * that was trusted on its own would keep a disabled login working until it
 * expired, and "disabled" that takes up to eight hours to mean anything is not
 * disabled. The read is one indexed primary-key lookup with a join the query
 * planner satisfies from the partner's own row.
 */
export async function resolvePartnerPrincipal(
  token: string | undefined,
  db: Db = prisma,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<PartnerAuthResult> {
  if (!isAffiliatePlatformRequested(env)) {
    return { ok: false, refusal: { kind: "platform_unavailable", status: 503 } };
  }
  if (resolvePartnerPlatformConfig(env).kind === "invalid") {
    return { ok: false, refusal: { kind: "platform_unavailable", status: 503 } };
  }

  const claims = verifyPartnerSessionToken(token, now, env);
  if (claims === null) {
    return { ok: false, refusal: { kind: "unauthenticated", status: 401 } };
  }

  const row = await db.affiliatePartnerUser.findUnique({
    where: { id: claims.partnerUserId },
    select: {
      id: true,
      publicId: true,
      email: true,
      displayName: true,
      status: true,
      sessionEpoch: true,
      affiliatePartnerId: true,
      // `passwordHash` is deliberately NOT selected. No read path that can
      // reach a response is allowed to load it, so it cannot be serialised by
      // an object spread somebody adds later.
      partner: { select: { id: true, code: true, displayName: true, status: true } },
    },
  });

  if (row === null || row.status !== "active") {
    return { ok: false, refusal: { kind: "unauthenticated", status: 401 } };
  }

  // THE REVOCATION CHECK. A token minted before a password change or a forced
  // sign-out carries the old epoch and dies here, regardless of its expiry.
  if (row.sessionEpoch !== claims.sessionEpoch) {
    return { ok: false, refusal: { kind: "unauthenticated", status: 401 } };
  }

  if (row.partner.status !== "active") {
    return { ok: false, refusal: { kind: "partner_not_active", status: 403 } };
  }

  return {
    ok: true,
    principal: {
      partnerUserId: row.id,
      partnerUserPublicId: row.publicId,
      email: row.email,
      displayName: row.displayName,
      affiliatePartnerId: row.affiliatePartnerId,
      partnerCode: row.partner.code,
      partnerDisplayName: row.partner.displayName,
      sessionExpiresAt: claims.expiresAt,
    },
  };
}
