import { NextResponse } from "next/server";
import { createAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  AffiliateInputError,
  AffiliateNotFoundError,
  assertOnlyKnownKeys,
  normalizeDisplayName,
  normalizeParameterName,
  normalizeWindowDays,
  parseAffiliateListQuery,
  withUniquePublicCode,
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
import { affiliateTrackingLinkListSchema, affiliateTrackingLinkSchema } from "@/lib/crm/schemas";
import { crmRequestId } from "@/lib/crm/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET  /api/crm/v1/affiliates/tracking-links  — list, filter, page
// POST /api/crm/v1/affiliates/tracking-links  — create a DRAFT link
//
// A created link is always `draft`, and `status` is not writable on create. The
// public route that would serve it does not exist until AFD-3B.

const LIST_KEYS = [
  "limit",
  "offset",
  "status",
  "search",
  "publicCode",
  "affiliatePartnerId",
  "affiliateCampaignId",
] as const;

const CREATE_KEYS = [
  "affiliatePartnerId",
  "affiliateCampaignId",
  "displayName",
  "landingKey",
  "externalClickParameter",
  "sub1Parameter",
  "sub2Parameter",
  "sub3Parameter",
  "sub4Parameter",
  "sub5Parameter",
  "attributionWindowDays",
] as const;

/**
 * Every configured parameter name must be distinct across the external click
 * parameter and sub1..sub5. Two mappings sharing a name would make the captured
 * value ambiguous the moment AFD-3B starts reading a real query string.
 */
function assertDistinctParameters(names: (string | null)[]): void {
  const present = names.filter((n): n is string => n !== null);
  if (new Set(present).size !== present.length) {
    throw new AffiliateInputError("crm.affiliates.link.parameter_duplicate");
  }
}

function parseOptionalId(raw: unknown, key: string): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    throw new AffiliateInputError("crm.affiliates.id_invalid");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AffiliateInputError("crm.affiliates.id_invalid");
  }
  void key;
  return value;
}

export async function GET(request: Request) {
  const requestId = crmRequestId();
  const headers = affiliateHeaders(requestId);

  try {
    await requireAffiliateReader();
    const query = parseAffiliateListQuery(new URL(request.url).searchParams, LIST_KEYS);

    if (query.status && !["draft", "paused", "archived"].includes(query.status)) {
      throw new AffiliateInputError("crm.affiliates.status_invalid");
    }

    const where = {
      ...(query.affiliatePartnerId ? { affiliatePartnerId: query.affiliatePartnerId } : {}),
      ...(query.affiliateCampaignId ? { affiliateCampaignId: query.affiliateCampaignId } : {}),
      ...(query.status ? { status: query.status as "draft" | "paused" | "archived" } : {}),
      ...(query.publicCode ? { publicCode: query.publicCode } : {}),
      ...(query.search ? { displayName: { contains: query.search } } : {}),
    };

    const [total, rows] = await prisma.$transaction([
      prisma.affiliateTrackingLink.count({ where }),
      prisma.affiliateTrackingLink.findMany({
        where,
        select: LINK_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit,
        skip: query.offset,
      }),
    ]);

    return NextResponse.json(
      affiliateTrackingLinkListSchema.parse({
        items: rows.map(toTrackingLinkDto),
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

    const partnerId = parseOptionalId(body.affiliatePartnerId, "affiliatePartnerId");
    if (partnerId === null) throw new AffiliateInputError("crm.affiliates.id_invalid");
    const campaignId = parseOptionalId(body.affiliateCampaignId, "affiliateCampaignId");

    const displayName = normalizeDisplayName(body.displayName, "crm.affiliates.display_name_invalid");

    // A logical key and nothing else. Any other value — including anything that
    // looks like a URL — is refused here, and refused again by the CHECK
    // constraint if it somehow reached the database.
    if (body.landingKey !== undefined && body.landingKey !== "academy_registration") {
      throw new AffiliateInputError("crm.affiliates.link.landing_key_invalid");
    }

    const externalClickParameter =
      body.externalClickParameter === undefined
        ? "clickid"
        : normalizeParameterName(body.externalClickParameter, "crm.affiliates.link.parameter_invalid");

    const subs = ([1, 2, 3, 4, 5] as const).map((n) => {
      const value = body[`sub${n}Parameter` as const];
      if (value === undefined || value === null) return null;
      return normalizeParameterName(value, "crm.affiliates.link.parameter_invalid");
    });

    assertDistinctParameters([externalClickParameter, ...subs]);

    const attributionWindowDays =
      body.attributionWindowDays === undefined || body.attributionWindowDays === null
        ? null
        : normalizeWindowDays(body.attributionWindowDays, "crm.affiliates.window_invalid");

    const partner = await prisma.affiliatePartner.findUnique({
      where: { id: partnerId },
      select: { id: true, code: true, status: true },
    });
    if (!partner) throw new AffiliateNotFoundError("crm.affiliates.not_found");
    if (partner.status === "archived") {
      throw new AffiliateInputError("crm.affiliates.parent_archived");
    }

    // The campaign's partner is verified by the composite foreign key, not by
    // this read: a cross-affiliate assignment fails at the database even if a
    // concurrent request changed something between the read and the write. The
    // read exists only to return a clean 404 for a campaign that is absent.
    if (campaignId !== null) {
      const campaign = await prisma.affiliateCampaign.findUnique({
        where: { id: campaignId },
        select: { id: true, status: true, affiliatePartnerId: true },
      });
      if (!campaign) throw new AffiliateNotFoundError("crm.affiliates.not_found");
      if (campaign.affiliatePartnerId !== partnerId) {
        throw new AffiliateInputError("crm.affiliates.link.campaign_partner_mismatch");
      }
      if (campaign.status === "archived") {
        throw new AffiliateInputError("crm.affiliates.parent_archived");
      }
    }

    const created = await withUniquePublicCode((publicCode) =>
      prisma.affiliateTrackingLink.create({
        data: {
          affiliatePartnerId: partnerId,
          affiliateCampaignId: campaignId,
          publicCode,
          displayName,
          status: "draft",
          landingKey: "academy_registration",
          externalClickParameter,
          sub1Parameter: subs[0],
          sub2Parameter: subs[1],
          sub3Parameter: subs[2],
          sub4Parameter: subs[3],
          sub5Parameter: subs[4],
          attributionWindowDays,
          createdByUserId: actorUserId,
        },
        select: LINK_SELECT,
      }),
    );

    await createAuditLog({
      userId: actorUserId,
      action: "AFFILIATE_TRACKING_LINK_CREATED",
      entityType: "AffiliateTrackingLink",
      entityId: created.id,
      // The publicCode is deliberately NOT audited. It is the one value on this
      // entity that will become a public identifier in AFD-3B, and an audit
      // trail is not where a future public code should first appear.
      metadata: { partnerCode: partner.code, status: created.status },
      request,
    });

    return NextResponse.json(affiliateTrackingLinkSchema.parse(toTrackingLinkDto(created)), {
      status: 201,
      headers,
    });
  } catch (error) {
    return affiliateErrorResponse(error, requestId, headers);
  }
}
