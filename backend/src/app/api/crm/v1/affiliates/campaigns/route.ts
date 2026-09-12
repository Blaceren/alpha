import { NextResponse } from "next/server";
import { createAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  AffiliateInputError,
  AffiliateNotFoundError,
  asConflict,
  assertOnlyKnownKeys,
  normalizeCode,
  normalizeDisplayName,
  normalizeOptionalText,
  parseAffiliateListQuery,
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
import { affiliateCampaignListSchema, affiliateCampaignSchema } from "@/lib/crm/schemas";
import { crmRequestId } from "@/lib/crm/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET  /api/crm/v1/affiliates/campaigns  — list, filterable by affiliate
// POST /api/crm/v1/affiliates/campaigns  — create under one affiliate

const LIST_KEYS = ["limit", "offset", "status", "code", "search", "affiliatePartnerId"] as const;
const CREATE_KEYS = ["affiliatePartnerId", "code", "displayName", "notes"] as const;

export async function GET(request: Request) {
  const requestId = crmRequestId();
  const headers = affiliateHeaders(requestId);

  try {
    await requireAffiliateReader();
    const query = parseAffiliateListQuery(new URL(request.url).searchParams, LIST_KEYS);

    const where = {
      ...(query.affiliatePartnerId ? { affiliatePartnerId: query.affiliatePartnerId } : {}),
      ...(query.status ? { status: query.status as "active" | "paused" | "archived" } : {}),
      ...(query.code ? { code: query.code } : {}),
      ...(query.search ? { displayName: { contains: query.search } } : {}),
    };

    const [total, rows] = await prisma.$transaction([
      prisma.affiliateCampaign.count({ where }),
      prisma.affiliateCampaign.findMany({
        where,
        select: CAMPAIGN_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit,
        skip: query.offset,
      }),
    ]);

    return NextResponse.json(
      affiliateCampaignListSchema.parse({
        items: rows.map(toCampaignDto),
        total,
        limit: query.limit,
        offset: query.offset,
      }),
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

    const body = assertOnlyKnownKeys(await readBoundedJson(request), CREATE_KEYS);

    if (typeof body.affiliatePartnerId !== "string" || !/^\d+$/.test(body.affiliatePartnerId)) {
      throw new AffiliateInputError("crm.affiliates.id_invalid");
    }
    const partnerId = Number(body.affiliatePartnerId);
    if (!Number.isSafeInteger(partnerId) || partnerId < 1) {
      throw new AffiliateInputError("crm.affiliates.id_invalid");
    }

    const code = normalizeCode(body.code, "crm.affiliates.code_invalid");
    const displayName = normalizeDisplayName(body.displayName, "crm.affiliates.display_name_invalid");
    const notes = normalizeOptionalText(body.notes, "crm.affiliates.notes_invalid");

    const partner = await prisma.affiliatePartner.findUnique({
      where: { id: partnerId },
      select: { id: true, code: true, status: true },
    });
    if (!partner) throw new AffiliateNotFoundError("crm.affiliates.not_found");

    // A campaign is created `active`, and an active child under a non-active
    // parent is a contradiction. Rather than quietly downgrade the new campaign
    // to paused, the create is refused so the operator resumes the affiliate
    // first and knows exactly what state they are in.
    if (partner.status !== "active") {
      throw new AffiliateInputError("crm.affiliates.campaign.parent_not_active");
    }

    let created;
    try {
      created = await prisma.affiliateCampaign.create({
        data: {
          affiliatePartnerId: partnerId,
          code,
          displayName,
          notes,
          status: "active",
          createdByUserId: actorUserId,
        },
        select: CAMPAIGN_SELECT,
      });
    } catch (error) {
      // UNIQUE(affiliatePartnerId, code) — the same code under a DIFFERENT
      // affiliate is legal and does not reach here.
      asConflict(error, "crm.affiliates.campaign.code_conflict");
    }

    await createAuditLog({
      userId: actorUserId,
      action: "AFFILIATE_CAMPAIGN_CREATED",
      entityType: "AffiliateCampaign",
      entityId: created.id,
      metadata: { code: created.code, partnerCode: partner.code, status: created.status },
      request,
    });

    return NextResponse.json(affiliateCampaignSchema.parse(toCampaignDto(created)), {
      status: 201,
      headers,
    });
  } catch (error) {
    return affiliateErrorResponse(error, requestId, headers);
  }
}
