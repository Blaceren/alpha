import { NextResponse } from "next/server";
import { createAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  AffiliateInputError,
  AffiliateLinkActivationUnavailableError,
  AffiliateNotFoundError,
  assertLinkTransition,
  assertOnlyKnownKeys,
  normalizeDisplayName,
  normalizeParameterName,
  normalizeWindowDays,
  parseAffiliatePathId,
  type TrackingLinkStatus,
} from "@/lib/crm/affiliates";
import {
  affiliateErrorResponse,
  affiliateHeaders,
  LINK_SELECT,
  readBoundedJson,
  requireAffiliateCsrf,
  requireAffiliateManager,
  resolveAffiliateActorUserId,
  toTrackingLinkDto,
} from "@/lib/crm/affiliate-routes";
import { affiliateTrackingLinkSchema } from "@/lib/crm/schemas";
import { crmRequestId } from "@/lib/crm/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET   /api/crm/v1/affiliates/tracking-links/[linkId]
// PATCH /api/crm/v1/affiliates/tracking-links/[linkId]
//
// `publicCode`, `affiliatePartnerId` and `landingKey` are absent from the
// writable set. The public code is immutable because it will be a public
// identifier; the partner is immutable because moving a link between affiliates
// would re-attribute whatever traffic it later carries.

type RouteContext = { params: Promise<{ linkId: string }> };

const PATCH_KEYS = [
  "displayName",
  "status",
  "affiliateCampaignId",
  "externalClickParameter",
  "sub1Parameter",
  "sub2Parameter",
  "sub3Parameter",
  "sub4Parameter",
  "sub5Parameter",
  "attributionWindowDays",
] as const;

export async function GET(request: Request, context: RouteContext) {
  const requestId = crmRequestId();
  const headers = affiliateHeaders(requestId);

  try {
    await requireAffiliateManager();
    if (new URL(request.url).searchParams.size > 0) {
      throw new AffiliateInputError("crm.affiliates.query_unknown");
    }

    const { linkId } = await context.params;
    const row = await prisma.affiliateTrackingLink.findUnique({
      where: { id: parseAffiliatePathId(linkId) },
      select: LINK_SELECT,
    });
    if (!row) throw new AffiliateNotFoundError("crm.affiliates.not_found");

    return NextResponse.json(affiliateTrackingLinkSchema.parse(toTrackingLinkDto(row)), { headers });
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

    const { linkId } = await context.params;
    const id = parseAffiliatePathId(linkId);
    const body = assertOnlyKnownKeys(await readBoundedJson(request), PATCH_KEYS);

    if (Object.keys(body).length === 0) {
      throw new AffiliateInputError("crm.affiliates.body_empty");
    }

    // Activation is refused BEFORE anything is read or written, and with its own
    // stable code, so an operator learns that activation does not exist yet
    // rather than seeing their request quietly succeed as something else.
    if (body.status === "active") {
      throw new AffiliateLinkActivationUnavailableError();
    }

    const existing = await prisma.affiliateTrackingLink.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        affiliatePartnerId: true,
        affiliateCampaignId: true,
        externalClickParameter: true,
        sub1Parameter: true,
        sub2Parameter: true,
        sub3Parameter: true,
        sub4Parameter: true,
        sub5Parameter: true,
        partner: { select: { code: true, status: true } },
      },
    });
    if (!existing) throw new AffiliateNotFoundError("crm.affiliates.not_found");

    const currentStatus = existing.status as TrackingLinkStatus;
    if (currentStatus === "archived") {
      throw new AffiliateInputError("crm.affiliates.archived_immutable");
    }

    const data: Record<string, unknown> = {};
    const changedFields: string[] = [];

    if (body.displayName !== undefined) {
      data.displayName = normalizeDisplayName(body.displayName, "crm.affiliates.display_name_invalid");
      changedFields.push("displayName");
    }

    if (body.attributionWindowDays !== undefined) {
      data.attributionWindowDays =
        body.attributionWindowDays === null
          ? null
          : normalizeWindowDays(body.attributionWindowDays, "crm.affiliates.window_invalid");
      changedFields.push("attributionWindowDays");
    }

    // Parameter names are re-validated as a COMPLETE set, merging submitted
    // values over stored ones, so a partial edit cannot create a duplicate pair
    // that neither the old nor the new value would have produced alone.
    const paramKeys = [
      "externalClickParameter",
      "sub1Parameter",
      "sub2Parameter",
      "sub3Parameter",
      "sub4Parameter",
      "sub5Parameter",
    ] as const;

    if (paramKeys.some((k) => body[k] !== undefined)) {
      const merged: (string | null)[] = [];
      for (const key of paramKeys) {
        const submitted = body[key];
        let value: string | null;
        if (submitted === undefined) {
          value = existing[key];
        } else if (submitted === null) {
          if (key === "externalClickParameter") {
            throw new AffiliateInputError("crm.affiliates.link.parameter_invalid");
          }
          value = null;
        } else {
          value = normalizeParameterName(submitted, "crm.affiliates.link.parameter_invalid");
        }
        merged.push(value);
        if (submitted !== undefined) {
          data[key] = value;
          changedFields.push(key);
        }
      }

      const present = merged.filter((n): n is string => n !== null);
      if (new Set(present).size !== present.length) {
        throw new AffiliateInputError("crm.affiliates.link.parameter_duplicate");
      }
    }

    if (body.affiliateCampaignId !== undefined) {
      // Reassignment is allowed only while the link is still draft or paused —
      // i.e. before it can ever have carried traffic. AFD-3B must revisit this
      // rule the moment a link can be active.
      if (body.affiliateCampaignId === null) {
        data.affiliateCampaignId = null;
      } else {
        if (typeof body.affiliateCampaignId !== "string" || !/^\d+$/.test(body.affiliateCampaignId)) {
          throw new AffiliateInputError("crm.affiliates.id_invalid");
        }
        const campaignId = Number(body.affiliateCampaignId);
        const campaign = await prisma.affiliateCampaign.findUnique({
          where: { id: campaignId },
          select: { id: true, status: true, affiliatePartnerId: true },
        });
        if (!campaign) throw new AffiliateNotFoundError("crm.affiliates.not_found");
        // Checked here for a clean error, and enforced regardless by the
        // composite foreign key on write.
        if (campaign.affiliatePartnerId !== existing.affiliatePartnerId) {
          throw new AffiliateInputError("crm.affiliates.link.campaign_partner_mismatch");
        }
        if (campaign.status === "archived") {
          throw new AffiliateInputError("crm.affiliates.parent_archived");
        }
        data.affiliateCampaignId = campaignId;
      }
      changedFields.push("affiliateCampaignId");
    }

    let nextStatus: TrackingLinkStatus | undefined;
    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !["draft", "paused", "archived"].includes(body.status)) {
        throw new AffiliateInputError("crm.affiliates.status_invalid");
      }
      nextStatus = body.status as TrackingLinkStatus;
      assertLinkTransition(currentStatus, nextStatus);
      data.status = nextStatus;
      data.archivedAt = nextStatus === "archived" ? new Date() : null;
      changedFields.push("status");
    }

    const result = await prisma.affiliateTrackingLink.updateMany({
      where: { id, status: currentStatus },
      data,
    });
    if (result.count === 0) {
      throw new AffiliateInputError("crm.affiliates.status_transition_invalid");
    }

    const updated = await prisma.affiliateTrackingLink.findUniqueOrThrow({
      where: { id },
      select: LINK_SELECT,
    });

    await createAuditLog({
      userId: actorUserId,
      action: nextStatus ? "AFFILIATE_TRACKING_LINK_STATUS_CHANGED" : "AFFILIATE_TRACKING_LINK_UPDATED",
      entityType: "AffiliateTrackingLink",
      entityId: id,
      // Field names only, and never the publicCode.
      metadata: {
        partnerCode: existing.partner.code,
        changedFields,
        ...(nextStatus ? { previousStatus: currentStatus, newStatus: nextStatus } : {}),
      },
      request,
    });

    return NextResponse.json(affiliateTrackingLinkSchema.parse(toTrackingLinkDto(updated)), { headers });
  } catch (error) {
    return affiliateErrorResponse(error, requestId, headers);
  }
}
