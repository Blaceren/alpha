/**
 * AFFILIATE-PLATFORM-V1 §30 — rotate an endpoint's signing secret.
 *
 * THE NEW SECRET IS RETURNED ONCE, HERE, AND NEVER AGAIN. That is the deliberate
 * product decision §30 permits: a one-time reveal at creation and at rotation,
 * and no read path afterwards. The alternative — a "show secret" button — means
 * the value is retrievable forever by anyone who reaches the console once.
 *
 * `secretVersion` IS BUMPED AND TRAVELS IN EVERY DELIVERY HEADER, so a receiver
 * holding both the old and the new secret knows which one to verify with
 * instead of trying both. Rotation is therefore not a flag day for the partner.
 *
 * `version` IS NOT BUMPED. The destination did not change, so no new logical
 * delivery is owed for any conversion already sent.
 */
import type { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { withPartnerRequest, partnerError, partnerJson } from "@/lib/affiliate/partner/request";
import { generatePostbackSigningSecret } from "@/lib/affiliate/postback/signature";

export const dynamic = "force-dynamic";

const schema = z.object({ endpointId: z.string().trim().length(32) });

export async function POST(request: Request): Promise<NextResponse> {
  return withPartnerRequest(request, async (principal) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return partnerError("invalid_request", "partner.postbacks.invalid_request");
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return partnerError("invalid_request", "partner.postbacks.invalid_request");
    }

    // THE TENANT PREDICATE IS IN THE LOOKUP, and the refusal for another
    // tenant's endpoint is the SAME 404 a nonexistent id gets. A partner cannot
    // learn that an endpoint id belongs to somebody.
    const endpoint = await prisma.affiliatePostbackEndpoint.findFirst({
      where: {
        publicId: parsed.data.endpointId,
        affiliatePartnerId: principal.affiliatePartnerId,
      },
      select: { id: true, publicId: true, eventType: true },
    });
    if (endpoint === null) {
      return partnerError("not_found", "partner.postbacks.not_found");
    }

    const secret = generatePostbackSigningSecret();
    const updated = await prisma.affiliatePostbackEndpoint.update({
      where: { id: endpoint.id },
      data: {
        signingSecret: secret,
        secretVersion: { increment: 1 },
        secretRotatedAt: new Date(),
      },
      select: { secretVersion: true },
    });

    await createAuditLog({
      action: "AFFILIATE_PARTNER_POSTBACK_SECRET_ROTATED",
      entityType: "AFFILIATE_POSTBACK_ENDPOINT",
      entityId: endpoint.publicId,
      // The VERSION, never the value.
      metadata: {
        affiliatePartnerId: principal.affiliatePartnerId,
        eventType: endpoint.eventType,
        secretVersion: updated.secretVersion,
      },
      request,
    });

    return partnerJson({
      endpointId: endpoint.publicId,
      secretVersion: updated.secretVersion,
      signingSecret: secret,
      signingSecretNotice: "shown_once",
    });
  });
}
