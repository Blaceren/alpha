import { NextResponse } from "next/server";
import { createAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { isAffiliateAttributionEnabled } from "@/lib/affiliate/attribution-config";
import {
  AffiliateAttributionDisabledError,
  AffiliateInputError,
  AffiliateNotFoundError,
  assertLinkTransition,
  assertOnlyKnownKeys,
  describeLinkActivationRefusal,
  normalizeDisplayName,
  normalizeParameterName,
  normalizeWindowDays,
  parseAffiliatePathId,
  TRACKING_LINK_STATUSES,
  type AffiliateStatus,
  type TrackingLinkStatus,
} from "@/lib/crm/affiliates";
import {
  affiliateErrorResponse,
  affiliateHeaders,
  LINK_SELECT,
  readBoundedJson,
  requireAffiliateCsrf,
  requireAffiliateManager,
  requireAffiliateReader,
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
    await requireAffiliateReader();
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

    // The feature switch is checked BEFORE anything is read or written, and with
    // its own stable code, so an operator on a deployment with attribution off
    // learns that rather than seeing their request quietly succeed as something
    // else. Every other activation condition needs the stored row and is checked
    // below, once it has been read.
    if (body.status === "active" && !isAffiliateAttributionEnabled()) {
      throw new AffiliateAttributionDisabledError();
    }

    const existing = await prisma.affiliateTrackingLink.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        publicCode: true,
        landingKey: true,
        affiliatePartnerId: true,
        affiliateCampaignId: true,
        externalClickParameter: true,
        sub1Parameter: true,
        sub2Parameter: true,
        sub3Parameter: true,
        sub4Parameter: true,
        sub5Parameter: true,
        attributionWindowDays: true,
        partner: {
          select: { code: true, status: true, defaultAttributionWindowDays: true },
        },
        campaign: { select: { status: true } },
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

    // The campaign this link will belong to after this request, which is what an
    // activation in the same request must be judged against.
    let nextCampaignStatus: AffiliateStatus | null = existing.campaign
      ? (existing.campaign.status as AffiliateStatus)
      : null;

    if (body.affiliateCampaignId !== undefined) {
      // AFD-3B2 revisits the AFD-2 rule, exactly as that phase's comment
      // demanded. Links can now carry traffic, and a conversion event snapshots
      // the campaign the link belongs to at attribution time — so moving a link
      // that already has clicks would silently re-bill historical traffic to a
      // campaign it never ran under.
      //
      // The gate is "has this link ever been clicked", not "is it active": a
      // link that was active, was paused and is now being edited has exactly the
      // same history problem, and a status check would miss it.
      const carriedTraffic = await prisma.affiliateClick.count({
        where: { trackingLinkId: id },
        take: 1,
      });
      if (carriedTraffic > 0) {
        throw new AffiliateInputError("crm.affiliates.link.campaign_locked_by_traffic");
      }

      if (body.affiliateCampaignId === null) {
        data.affiliateCampaignId = null;
        nextCampaignStatus = null;
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
        nextCampaignStatus = campaign.status as AffiliateStatus;
      }
      changedFields.push("affiliateCampaignId");
    }

    let nextStatus: TrackingLinkStatus | undefined;
    if (body.status !== undefined) {
      if (
        typeof body.status !== "string" ||
        !TRACKING_LINK_STATUSES.includes(body.status as TrackingLinkStatus)
      ) {
        throw new AffiliateInputError("crm.affiliates.status_invalid");
      }
      nextStatus = body.status as TrackingLinkStatus;
      assertLinkTransition(currentStatus, nextStatus);

      if (nextStatus === "active") {
        // The activation gate, evaluated against the row as it will be AFTER
        // this same request's other edits: an operator fixing a parameter
        // mapping and activating in one call must be judged on the mapping they
        // are submitting, not the one they are replacing.
        const refusal = describeLinkActivationRefusal(
          {
            publicCode: existing.publicCode,
            landingKey: existing.landingKey,
            partnerStatus: existing.partner.status as AffiliateStatus,
            campaignStatus: nextCampaignStatus,
            externalClickParameter:
              (data.externalClickParameter as string | undefined) ?? existing.externalClickParameter,
            subParameters: (["sub1Parameter", "sub2Parameter", "sub3Parameter", "sub4Parameter", "sub5Parameter"] as const).map(
              (key) => (key in data ? (data[key] as string | null) : existing[key]),
            ),
            attributionWindowDays:
              "attributionWindowDays" in data
                ? (data.attributionWindowDays as number | null)
                : existing.attributionWindowDays,
            partnerDefaultAttributionWindowDays: existing.partner.defaultAttributionWindowDays,
          },
          isAffiliateAttributionEnabled(),
        );
        if (refusal === "attribution_disabled") throw new AffiliateAttributionDisabledError();
        if (refusal !== null) {
          throw new AffiliateInputError(`crm.affiliates.link.activation.${refusal}`);
        }
      }

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
