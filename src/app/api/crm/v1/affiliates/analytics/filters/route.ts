import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { effectiveAvailability, type AffiliateStatus, type TrackingLinkStatus } from "@/lib/crm/affiliates";
import {
  analyticsErrorResponse,
  beginAnalyticsRequest,
  openAnalyticsRequest,
} from "@/lib/analytics/routes";
import {
  assertFilterHierarchy,
  assertKnownAnalyticsKeys,
  parseFilters,
} from "@/lib/analytics/request";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/crm/v1/affiliates/analytics/filters — the bounded option set a
// filter UI needs, and nothing else.
//
// WHAT IS DELIBERATELY ABSENT: external affiliate click ids, ataClickIds,
// anonymous visitor ids, Pocket click ids, Pocket player ids, callback data,
// learner emails and any secret. None of them is selected below, so none can
// reach the wire by accident.

const KEYS = ["affiliatePartnerId", "affiliateCampaignId"] as const;

/**
 * Every partner, plus the campaigns and links under whichever parent was named.
 *
 * BOUNDED BY PARENT FILTERING rather than by a page: an operator picks an
 * affiliate first, so the campaign and link lists only ever describe one
 * partner. Without a parent the two child lists are capped, because a deployment
 * with thousands of links must not be able to turn one dropdown into an
 * unbounded response.
 */
const MAX_UNPARENTED_CHILDREN = 500;

export async function GET(request: Request) {
  const { requestId, headers } = beginAnalyticsRequest();

  try {
    const { params } = await openAnalyticsRequest(request);
    assertKnownAnalyticsKeys(params, KEYS);
    const filters = parseFilters(params);
    await assertFilterHierarchy(filters);

    const partnerWhere =
      filters.affiliatePartnerId === undefined ? {} : { id: filters.affiliatePartnerId };
    const childWhere = {
      ...(filters.affiliatePartnerId === undefined
        ? {}
        : { affiliatePartnerId: filters.affiliatePartnerId }),
    };
    const linkWhere = {
      ...childWhere,
      ...(filters.affiliateCampaignId === undefined
        ? {}
        : { affiliateCampaignId: filters.affiliateCampaignId }),
    };

    const [partners, campaigns, links] = await prisma.$transaction([
      prisma.affiliatePartner.findMany({
        where: partnerWhere,
        select: { id: true, code: true, displayName: true, status: true, archivedAt: true },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
        take: MAX_UNPARENTED_CHILDREN,
      }),
      prisma.affiliateCampaign.findMany({
        where: childWhere,
        select: {
          id: true,
          affiliatePartnerId: true,
          code: true,
          displayName: true,
          status: true,
          archivedAt: true,
        },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
        take: MAX_UNPARENTED_CHILDREN,
      }),
      prisma.affiliateTrackingLink.findMany({
        where: linkWhere,
        select: {
          id: true,
          affiliatePartnerId: true,
          affiliateCampaignId: true,
          publicCode: true,
          displayName: true,
          status: true,
          archivedAt: true,
          partner: { select: { status: true } },
          campaign: { select: { status: true } },
        },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
        take: MAX_UNPARENTED_CHILDREN,
      }),
    ]);

    return NextResponse.json(
      {
        affiliatePartners: partners.map((partner) => ({
          id: String(partner.id),
          code: partner.code,
          displayName: partner.displayName,
          status: partner.status,
          archived: partner.archivedAt !== null,
        })),
        affiliateCampaigns: campaigns.map((campaign) => ({
          id: String(campaign.id),
          affiliatePartnerId: String(campaign.affiliatePartnerId),
          code: campaign.code,
          displayName: campaign.displayName,
          status: campaign.status,
          archived: campaign.archivedAt !== null,
        })),
        affiliateTrackingLinks: links.map((link) => {
          const parents: AffiliateStatus[] = [link.partner.status as AffiliateStatus];
          if (link.campaign) parents.push(link.campaign.status as AffiliateStatus);
          return {
            id: String(link.id),
            affiliatePartnerId: String(link.affiliatePartnerId),
            affiliateCampaignId:
              link.affiliateCampaignId === null ? null : String(link.affiliateCampaignId),
            // The publicCode is already the operator-facing identifier the CRM
            // shows in the management workspace, so it is not new exposure here.
            publicCode: link.publicCode,
            displayName: link.displayName,
            status: link.status,
            availability: effectiveAvailability(link.status as TrackingLinkStatus, parents),
            archived: link.archivedAt !== null,
          };
        }),
      },
      { headers },
    );
  } catch (error) {
    return analyticsErrorResponse(error, requestId, headers);
  }
}
