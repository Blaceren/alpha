/**
 * AFFILIATE-PLATFORM-V1 §20/§46 — the partner's own tracking links.
 *
 * A PARTNER MAY CREATE A LINK. THEY MAY NOT CHOOSE WHERE IT GOES.
 *
 * `landingKey` is a server-owned KEY, not a URL, and this route never accepts
 * one from the request: every link created here lands on
 * `academy_registration`, the only value the enum has. That is what makes an
 * open redirect UNREPRESENTABLE rather than defended against — there is no
 * field in which to put a destination.
 *
 * THE PARTNER ID IS NEVER ACCEPTED EITHER. It comes from the session, so a
 * forged `affiliatePartnerId` has nowhere to go, and a campaign that belongs to
 * another tenant resolves to nothing in the lookup below. The composite foreign
 * key `(affiliateCampaignId, affiliatePartnerId)` then makes a link whose
 * campaign belongs to a different partner impossible AT THE DATABASE, so even a
 * defect in this handler could not produce one.
 *
 * A CAMPAIGN IS REQUIRED. §20 gives staff control of commercial eligibility: a
 * partner may create links only UNDER a campaign staff created for them. A link
 * with no campaign has no commercial owner and could never qualify a deposit,
 * so allowing one would be offering a partner a link that silently earns
 * nothing.
 *
 * THE LINK IS CREATED `active`. It is the partner's own link under their own
 * campaign, and a draft they cannot publish would be a dead control.
 */
import type { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { randomBase32Id } from "@/lib/affiliate/random-id";
import { withPartnerRequest, partnerError, partnerJson } from "@/lib/affiliate/partner/request";
import { resolvePublicAppUrl } from "@/lib/publicUrl";

export const dynamic = "force-dynamic";

/**
 * Parameter NAMES a link will accept, never captured values. Lowercase
 * alphanumeric and underscore only, which is the same bound the schema CHECK
 * enforces and the same one the acquisition route already relies on.
 */
const parameterName = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9_]+$/);

const createSchema = z.object({
  campaignCode: z.string().trim().min(1).max(64),
  displayName: z.string().trim().min(1).max(160),
  externalClickParameter: parameterName.optional(),
  sub1Parameter: parameterName.optional(),
  sub2Parameter: parameterName.optional(),
  sub3Parameter: parameterName.optional(),
  sub4Parameter: parameterName.optional(),
  sub5Parameter: parameterName.optional(),
});

function publicLinkUrl(publicCode: string): string | null {
  const resolved = resolvePublicAppUrl();
  if (resolved.kind !== "configured") return null;
  return `${resolved.origin}/go/${publicCode}`;
}

export async function GET(request: Request): Promise<NextResponse> {
  return withPartnerRequest(request, async (principal) => {
    const rows = await prisma.affiliateTrackingLink.findMany({
      where: { affiliatePartnerId: principal.affiliatePartnerId },
      orderBy: { id: "desc" },
      take: 100,
      select: {
        publicCode: true,
        displayName: true,
        status: true,
        externalClickParameter: true,
        sub1Parameter: true,
        sub2Parameter: true,
        sub3Parameter: true,
        sub4Parameter: true,
        sub5Parameter: true,
        createdAt: true,
        campaign: { select: { code: true, displayName: true } },
      },
    });

    return partnerJson({
      rows: rows.map((row) => ({
        publicCode: row.publicCode,
        url: publicLinkUrl(row.publicCode),
        displayName: row.displayName,
        status: row.status,
        campaignCode: row.campaign?.code ?? null,
        campaignDisplayName: row.campaign?.displayName ?? null,
        parameters: {
          externalClickParameter: row.externalClickParameter,
          sub1: row.sub1Parameter,
          sub2: row.sub2Parameter,
          sub3: row.sub3Parameter,
          sub4: row.sub4Parameter,
          sub5: row.sub5Parameter,
        },
        createdAt: row.createdAt.toISOString(),
      })),
    });
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  return withPartnerRequest(request, async (principal) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return partnerError("invalid_request", "partner.links.invalid_request");
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return partnerError("invalid_request", "partner.links.invalid_request");
    }

    // TENANT-SCOPED LOOKUP. Another partner's campaign code finds nothing, and
    // the refusal is identical to the one a nonexistent code produces — so this
    // is not an existence oracle over other tenants' campaign codes.
    const campaign = await prisma.affiliateCampaign.findFirst({
      where: {
        affiliatePartnerId: principal.affiliatePartnerId,
        code: parsed.data.campaignCode,
        status: "active",
      },
      select: { id: true },
    });
    if (campaign === null) {
      return partnerError("invalid_request", "partner.links.unknown_campaign");
    }

    const created = await prisma.affiliateTrackingLink.create({
      data: {
        affiliatePartnerId: principal.affiliatePartnerId,
        affiliateCampaignId: campaign.id,
        publicCode: randomBase32Id(),
        displayName: parsed.data.displayName,
        status: "active",
        // SERVER-OWNED, AND NOT A REQUEST FIELD. See the module header.
        landingKey: "academy_registration",
        externalClickParameter: parsed.data.externalClickParameter ?? "clickid",
        sub1Parameter: parsed.data.sub1Parameter ?? null,
        sub2Parameter: parsed.data.sub2Parameter ?? null,
        sub3Parameter: parsed.data.sub3Parameter ?? null,
        sub4Parameter: parsed.data.sub4Parameter ?? null,
        sub5Parameter: parsed.data.sub5Parameter ?? null,
        // THE PARTNER CREATOR AXIS. `createdByUserId` stays NULL: no ATA
        // employee authored this link, and the CHECK constraint requires
        // exactly one of the two to be set.
        createdByPartnerUserId: principal.partnerUserId,
      },
      select: { publicCode: true, displayName: true, status: true, createdAt: true },
    });

    await createAuditLog({
      action: "AFFILIATE_PARTNER_TRACKING_LINK_CREATED",
      entityType: "AFFILIATE_TRACKING_LINK",
      entityId: created.publicCode,
      metadata: {
        affiliatePartnerId: principal.affiliatePartnerId,
        partnerUserPublicId: principal.partnerUserPublicId,
        campaignCode: parsed.data.campaignCode,
      },
      request,
    });

    return partnerJson(
      {
        publicCode: created.publicCode,
        url: publicLinkUrl(created.publicCode),
        displayName: created.displayName,
        status: created.status,
        campaignCode: parsed.data.campaignCode,
        createdAt: created.createdAt.toISOString(),
      },
      201,
    );
  });
}
