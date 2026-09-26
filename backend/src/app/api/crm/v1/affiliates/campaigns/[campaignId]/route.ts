import { NextResponse } from "next/server";
import { createAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  AffiliateInputError,
  AffiliateNotFoundError,
  assertEntityTransition,
  assertOnlyKnownKeys,
  normalizeDisplayName,
  normalizeOptionalText,
  parseAffiliatePathId,
  type AffiliateStatus,
} from "@/lib/crm/affiliates";
import {
  affiliateErrorResponse,
  affiliateHeaders,
  CAMPAIGN_SELECT,
  readBoundedJson,
  requireAffiliateCsrf,
  requireAffiliateManager,
  requireAffiliateReader,
  resolveAffiliateActorUserId,
  toCampaignDto,
} from "@/lib/crm/affiliate-routes";
import { affiliateCampaignSchema } from "@/lib/crm/schemas";
import { crmRequestId } from "@/lib/crm/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET   /api/crm/v1/affiliates/campaigns/[campaignId]
// PATCH /api/crm/v1/affiliates/campaigns/[campaignId]
//
// `code` and `affiliatePartnerId` are absent from the writable set: a campaign
// never moves between affiliates, because its historical links would then be
// attributed to a partner that never ran them.

type RouteContext = { params: Promise<{ campaignId: string }> };

const PATCH_KEYS = ["displayName", "notes", "status"] as const;

export async function GET(request: Request, context: RouteContext) {
  const requestId = crmRequestId();
  const headers = affiliateHeaders(requestId);

  try {
    await requireAffiliateReader();
    if (new URL(request.url).searchParams.size > 0) {
      throw new AffiliateInputError("crm.affiliates.query_unknown");
    }

    const { campaignId } = await context.params;
    const row = await prisma.affiliateCampaign.findUnique({
      where: { id: parseAffiliatePathId(campaignId) },
      select: CAMPAIGN_SELECT,
    });
    if (!row) throw new AffiliateNotFoundError("crm.affiliates.not_found");

    return NextResponse.json(affiliateCampaignSchema.parse(toCampaignDto(row)), { headers });
  } catch (error) {
    return affiliateErrorResponse(error, requestId, headers);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = crmRequestId();
  const headers = affiliateHeaders(requestId);

  try {
    await requireAffiliateManager();
    await requireAffiliateCsrf(request);
    const actorUserId = await resolveAffiliateActorUserId();

    if (new URL(request.url).searchParams.size > 0) {
      throw new AffiliateInputError("crm.affiliates.query_unknown");
    }

    const { campaignId } = await context.params;
    const id = parseAffiliatePathId(campaignId);
    const body = assertOnlyKnownKeys(await readBoundedJson(request), PATCH_KEYS);

    if (Object.keys(body).length === 0) {
      throw new AffiliateInputError("crm.affiliates.body_empty");
    }

    const existing = await prisma.affiliateCampaign.findUnique({
      where: { id },
      select: { id: true, code: true, status: true, partner: { select: { code: true, status: true } } },
    });
    if (!existing) throw new AffiliateNotFoundError("crm.affiliates.not_found");

    const currentStatus = existing.status as AffiliateStatus;
    if (currentStatus === "archived") {
      throw new AffiliateInputError("crm.affiliates.archived_immutable");
    }

    const data: Record<string, unknown> = {};
    const changedFields: string[] = [];

    if (body.displayName !== undefined) {
      data.displayName = normalizeDisplayName(body.displayName, "crm.affiliates.display_name_invalid");
      changedFields.push("displayName");
    }
    if (body.notes !== undefined) {
      data.notes = normalizeOptionalText(body.notes, "crm.affiliates.notes_invalid");
      changedFields.push("notes");
    }

    let nextStatus: AffiliateStatus | undefined;
    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !["active", "paused", "archived"].includes(body.status)) {
        throw new AffiliateInputError("crm.affiliates.status_invalid");
      }
      nextStatus = body.status as AffiliateStatus;
      assertEntityTransition(currentStatus, nextStatus);

      // Resuming a campaign requires a live parent. Without this a paused
      // affiliate could be worked around one campaign at a time.
      if (nextStatus === "active" && existing.partner.status !== "active") {
        throw new AffiliateInputError("crm.affiliates.campaign.parent_not_active");
      }

      data.status = nextStatus;
      data.archivedAt = nextStatus === "archived" ? new Date() : null;
      changedFields.push("status");
    }

    const result = await prisma.affiliateCampaign.updateMany({
      where: { id, status: currentStatus },
      data,
    });
    if (result.count === 0) {
      throw new AffiliateInputError("crm.affiliates.status_transition_invalid");
    }

    const updated = await prisma.affiliateCampaign.findUniqueOrThrow({
      where: { id },
      select: CAMPAIGN_SELECT,
    });

    await createAuditLog({
      userId: actorUserId,
      action: nextStatus ? "AFFILIATE_CAMPAIGN_STATUS_CHANGED" : "AFFILIATE_CAMPAIGN_UPDATED",
      entityType: "AffiliateCampaign",
      entityId: id,
      metadata: {
        code: existing.code,
        partnerCode: existing.partner.code,
        changedFields,
        ...(nextStatus ? { previousStatus: currentStatus, newStatus: nextStatus } : {}),
      },
      request,
    });

    return NextResponse.json(affiliateCampaignSchema.parse(toCampaignDto(updated)), { headers });
  } catch (error) {
    return affiliateErrorResponse(error, requestId, headers);
  }
}
