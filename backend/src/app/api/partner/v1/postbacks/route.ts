/**
 * AFFILIATE-PLATFORM-V1 §26/§29/§30 — where a partner points their conversions.
 *
 * THE DESTINATION IS VALIDATED THREE TIMES, AND THAT IS NOT REDUNDANCY:
 *
 *   1. HERE, as a TEMPLATE — macro vocabulary, fixed host, https, no
 *      credentials, no fragment. A typo is refused while somebody is looking.
 *   2. HERE, as a DESTINATION — the SSRF gate resolves the hostname and checks
 *      every address, so a partner cannot save a destination that already
 *      points at a private network and discover the refusal only in a delivery
 *      log they never read.
 *   3. AT EVERY DELIVERY ATTEMPT, and after every redirect, because the address
 *      a name resolves to can change between saving and sending. That third
 *      one is the only one that is a security control; the first two are there
 *      so a partner gets an immediate, actionable answer.
 *
 * THE SIGNING SECRET IS RETURNED EXACTLY ONCE — in the response that creates or
 * rotates it — and by NO read path afterwards. `GET` does not select the
 * column. §30.
 *
 * CHANGING THE URL BUMPS THE VERSION. That is not bookkeeping: the version is
 * half the delivery idempotency key, so re-pointing an endpoint legitimately
 * produces a NEW logical delivery for a conversion already delivered to the old
 * address, and neither duplicates the other.
 */
import type { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { randomBase32Id } from "@/lib/affiliate/random-id";
import { withPartnerRequest, partnerError, partnerJson } from "@/lib/affiliate/partner/request";
import { validatePostbackTemplate } from "@/lib/affiliate/postback/template";
import { resolveDestination } from "@/lib/affiliate/postback/destination";
import { generatePostbackSigningSecret } from "@/lib/affiliate/postback/signature";

export const dynamic = "force-dynamic";

const EVENT_TYPES = ["academy_registration", "first_deposit", "redeposit"] as const;

const upsertSchema = z.object({
  eventType: z.enum(EVENT_TYPES),
  urlTemplate: z.string().trim().min(12).max(2048),
  status: z.enum(["active", "disabled"]).optional(),
});

/**
 * Probe the destination the template will actually produce.
 *
 * MACROS ARE REPLACED WITH A BENIGN PLACEHOLDER, because the guard needs a
 * concrete URL and the HOST is already proved fixed by the template validator.
 * The values a real delivery substitutes cannot change the host, so probing the
 * placeholder form tests exactly the thing that matters.
 */
async function probeDestination(template: string) {
  const probe = template.replace(/\{[^{}]*\}/g, "x");
  return resolveDestination(probe);
}

export async function GET(request: Request): Promise<NextResponse> {
  return withPartnerRequest(request, async (principal) => {
    const rows = await prisma.affiliatePostbackEndpoint.findMany({
      where: { affiliatePartnerId: principal.affiliatePartnerId },
      orderBy: { eventType: "asc" },
      // `signingSecret` IS ABSENT FROM THIS SELECT. Not filtered later — never
      // loaded, so no serialiser, spread or logging call can reach it.
      select: {
        publicId: true,
        eventType: true,
        urlTemplate: true,
        version: true,
        status: true,
        secretVersion: true,
        secretRotatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return partnerJson({
      rows: rows.map((row) => ({
        endpointId: row.publicId,
        eventType: row.eventType,
        urlTemplate: row.urlTemplate,
        version: row.version,
        status: row.status,
        secretVersion: row.secretVersion,
        secretRotatedAt: row.secretRotatedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  });
}

export async function PUT(request: Request): Promise<NextResponse> {
  return withPartnerRequest(request, async (principal) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return partnerError("invalid_request", "partner.postbacks.invalid_request");
    }

    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) {
      return partnerError("invalid_request", "partner.postbacks.invalid_request");
    }

    const template = validatePostbackTemplate(parsed.data.urlTemplate);
    if (!template.ok) {
      return partnerError("invalid_request", `partner.postbacks.template.${template.reason}`);
    }

    const probe = await probeDestination(template.template);
    if (!probe.ok) {
      // THE REASON IS RETURNED, and it is a bounded code rather than free text.
      // A partner who typed an internal hostname deserves to be told which rule
      // they hit, and none of these codes reveals anything about ATA's network.
      return partnerError("invalid_request", `partner.postbacks.destination.${probe.reason}`);
    }

    const now = new Date();
    const existing = await prisma.affiliatePostbackEndpoint.findUnique({
      where: {
        affiliatePartnerId_eventType: {
          affiliatePartnerId: principal.affiliatePartnerId,
          eventType: parsed.data.eventType,
        },
      },
      select: { id: true, publicId: true, urlTemplate: true, version: true, status: true },
    });

    if (existing === null) {
      const secret = generatePostbackSigningSecret();
      const created = await prisma.affiliatePostbackEndpoint.create({
        data: {
          publicId: randomBase32Id(),
          affiliatePartnerId: principal.affiliatePartnerId,
          eventType: parsed.data.eventType,
          urlTemplate: template.template,
          version: 1,
          status: parsed.data.status ?? "active",
          disabledAt: parsed.data.status === "disabled" ? now : null,
          signingSecret: secret,
          secretVersion: 1,
          createdByPartnerUserId: principal.partnerUserId,
        },
        select: { publicId: true, version: true, status: true, secretVersion: true },
      });

      await createAuditLog({
        action: "AFFILIATE_PARTNER_POSTBACK_ENDPOINT_CREATED",
        entityType: "AFFILIATE_POSTBACK_ENDPOINT",
        entityId: created.publicId,
        // THE TEMPLATE IS NOT AUDITED AND THE SECRET CERTAINLY IS NOT. The
        // event type and the version are enough to reconstruct what changed
        // from the row itself.
        metadata: {
          affiliatePartnerId: principal.affiliatePartnerId,
          eventType: parsed.data.eventType,
          version: created.version,
        },
        request,
      });

      return partnerJson(
        {
          endpointId: created.publicId,
          eventType: parsed.data.eventType,
          version: created.version,
          status: created.status,
          secretVersion: created.secretVersion,
          // THE ONE AND ONLY REVEAL.
          signingSecret: secret,
          signingSecretNotice: "shown_once",
        },
        201,
      );
    }

    const urlChanged = existing.urlTemplate !== template.template;
    const status = parsed.data.status ?? existing.status;

    const updated = await prisma.affiliatePostbackEndpoint.update({
      where: { id: existing.id },
      data: {
        urlTemplate: template.template,
        // ONLY A URL CHANGE BUMPS THE VERSION. Enabling or disabling an
        // endpoint is not a new destination, and bumping for it would create a
        // duplicate logical delivery for every conversion already sent.
        version: urlChanged ? { increment: 1 } : undefined,
        status,
        disabledAt: status === "disabled" ? now : null,
      },
      select: { publicId: true, version: true, status: true, secretVersion: true },
    });

    await createAuditLog({
      action: "AFFILIATE_PARTNER_POSTBACK_ENDPOINT_UPDATED",
      entityType: "AFFILIATE_POSTBACK_ENDPOINT",
      entityId: updated.publicId,
      metadata: {
        affiliatePartnerId: principal.affiliatePartnerId,
        eventType: parsed.data.eventType,
        version: updated.version,
        urlChanged,
        status: updated.status,
      },
      request,
    });

    return partnerJson({
      endpointId: updated.publicId,
      eventType: parsed.data.eventType,
      version: updated.version,
      status: updated.status,
      secretVersion: updated.secretVersion,
    });
  });
}
