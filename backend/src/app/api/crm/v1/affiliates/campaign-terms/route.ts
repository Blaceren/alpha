/**
 * AFFILIATE-PLATFORM-V1 §10/§19/§42 — the staff CPA configuration surface.
 *
 * GET  the version history of one campaign's price
 * POST set a new price, superseding the current one
 *
 * `manage_settings` IS REQUIRED TO WRITE, and `view_affiliate_analytics` or
 * `manage_settings` to read — exactly the split the accepted affiliate CRM
 * already uses. No new permission is invented: a price is affiliate
 * configuration, and affiliate configuration already has an owner.
 *
 * THERE IS NO EDIT AND NO DELETE, and that is the §11 guarantee expressed as an
 * absence of routes. Setting a price appends a version and supersedes the
 * previous one; nothing in this API can reach the amount a past commission was
 * computed from.
 *
 * THE HISTORY IS STAFF-ONLY. A partner sees the ACTIVE rate they are working
 * under (they are entitled to that) and not the versions before it, which are
 * ATA's internal record of a negotiation.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { AffiliateInputError } from "@/lib/crm/affiliates";
import {
  affiliateErrorResponse,
  affiliateHeaders,
  readBoundedJson,
  requireAffiliateCsrf,
  requireAffiliateManager,
  requireAffiliateReader,
  resolveAffiliateActorUserId,
} from "@/lib/crm/affiliate-routes";
import { crmRequestId } from "@/lib/crm/session";
import { setCampaignCpaTerms, SUPPORTED_CPA_CURRENCIES } from "@/lib/affiliate/commercial/terms";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const setSchema = z.object({
  affiliateCampaignId: z.number().int().positive(),
  cpaAmount: z.string().trim().min(1).max(15),
  cpaCurrency: z.enum(SUPPORTED_CPA_CURRENCIES),
});

export async function GET(request: Request) {
  const requestId = crmRequestId();
  const headers = affiliateHeaders(requestId);
  try {
    await requireAffiliateReader();
    const raw = new URL(request.url).searchParams.get("affiliateCampaignId");
    const campaignId = Number(raw);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      throw new AffiliateInputError("crm.affiliates.terms.campaign_required");
    }

    const rows = await prisma.affiliateCampaignTerms.findMany({
      where: { affiliateCampaignId: campaignId },
      orderBy: { version: "desc" },
      select: {
        publicId: true,
        version: true,
        cpaAmount: true,
        cpaCurrency: true,
        status: true,
        effectiveFrom: true,
        supersededAt: true,
        createdAt: true,
        createdBy: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(
      {
        items: rows.map((row) => ({
          termsId: row.publicId,
          version: row.version,
          cpaAmount: row.cpaAmount,
          cpaCurrency: row.cpaCurrency,
          status: row.status,
          effectiveFrom: row.effectiveFrom.toISOString(),
          supersededAt: row.supersededAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          createdByStaffName: row.createdBy.name,
        })),
        total: rows.length,
      },
      { headers },
    );
  } catch (error) {
    return affiliateErrorResponse(error, requestId, headers);
  }
}

export async function POST(request: Request) {
  const requestId = crmRequestId();
  const headers = affiliateHeaders(requestId);
  try {
    await requireAffiliateManager();
    await requireAffiliateCsrf(request);
    const actorUserId = await resolveAffiliateActorUserId();

    const body = await readBoundedJson(request);
    const parsed = setSchema.safeParse(body);
    if (!parsed.success) throw new AffiliateInputError("crm.affiliates.terms.invalid");

    const result = await setCampaignCpaTerms(prisma, {
      affiliateCampaignId: parsed.data.affiliateCampaignId,
      cpaAmount: parsed.data.cpaAmount,
      cpaCurrency: parsed.data.cpaCurrency,
      actorUserId,
      now: new Date(),
    });

    if (!result.ok) throw new AffiliateInputError(`crm.affiliates.terms.${result.reason}`);

    // BOTH SIDES OF THE CHANGE ARE AUDITED. "The CPA is now 150" is not an
    // auditable fact on its own — what an operator needs later is that it was
    // 100 and who changed it.
    await createAuditLog({
      userId: actorUserId,
      action: "AFFILIATE_CAMPAIGN_CPA_TERMS_SET",
      entityType: "AFFILIATE_CAMPAIGN_TERMS",
      entityId: result.publicId,
      metadata: {
        affiliateCampaignId: parsed.data.affiliateCampaignId,
        version: result.version,
        cpaAmount: result.cpaAmount,
        cpaCurrency: result.cpaCurrency,
        previousVersion: result.previous?.version ?? null,
        previousCpaAmount: result.previous?.cpaAmount ?? null,
        previousCpaCurrency: result.previous?.cpaCurrency ?? null,
      },
      request,
    });

    return NextResponse.json(
      {
        termsId: result.publicId,
        version: result.version,
        cpaAmount: result.cpaAmount,
        cpaCurrency: result.cpaCurrency,
        supersededVersion: result.previous?.version ?? null,
      },
      { status: 201, headers },
    );
  } catch (error) {
    return affiliateErrorResponse(error, requestId, headers);
  }
}
