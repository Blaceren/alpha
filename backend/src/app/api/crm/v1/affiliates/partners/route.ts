import { NextResponse } from "next/server";
import { createAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  AFFILIATE_WINDOW_DEFAULT,
  asConflict,
  assertOnlyKnownKeys,
  normalizeCode,
  normalizeDisplayName,
  normalizeOptionalText,
  normalizeWindowDays,
  parseAffiliateListQuery,
} from "@/lib/crm/affiliates";
import {
  affiliateErrorResponse,
  affiliateHeaders,
  PARTNER_SELECT,
  readBoundedJson,
  requireAffiliateCsrf,
  requireAffiliateManager,
  requireAffiliateReader,
  resolveAffiliateActorUserId,
  toPartnerDto,
} from "@/lib/crm/affiliate-routes";
import { affiliatePartnerListSchema, affiliatePartnerSchema } from "@/lib/crm/schemas";
import { crmRequestId } from "@/lib/crm/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET  /api/crm/v1/affiliates/partners  — list, filter, page
// POST /api/crm/v1/affiliates/partners  — create
//
// There is deliberately no DELETE anywhere in the AFD-2 surface. An affiliate
// with history is archived, never removed, so a report covering last month can
// still explain where its leads came from.

const LIST_KEYS = ["limit", "offset", "status", "code", "search"] as const;
const CREATE_KEYS = ["code", "displayName", "description", "defaultAttributionWindowDays"] as const;

export async function GET(request: Request) {
  const requestId = crmRequestId();
  const headers = affiliateHeaders(requestId);

  try {
    await requireAffiliateReader();

    const query = parseAffiliateListQuery(new URL(request.url).searchParams, LIST_KEYS);

    const where = {
      ...(query.status ? { status: query.status as "active" | "paused" | "archived" } : {}),
      ...(query.code ? { code: query.code } : {}),
      ...(query.search ? { displayName: { contains: query.search } } : {}),
    };

    // Count and page inside one transaction so `total` describes exactly the
    // rows the page was drawn from. Paging can never change the total.
    const [total, rows] = await prisma.$transaction([
      prisma.affiliatePartner.count({ where }),
      prisma.affiliatePartner.findMany({
        where,
        select: PARTNER_SELECT,
        // Deterministic: newest first, with the id as a total-order tie-break
        // so two rows sharing a timestamp never swap between pages.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit,
        skip: query.offset,
      }),
    ]);

    const body = affiliatePartnerListSchema.parse({
      items: rows.map(toPartnerDto),
      total,
      limit: query.limit,
      offset: query.offset,
    });

    return NextResponse.json(body, { headers });
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

    const raw = await readBoundedJson(request);
    // Rejects a client-supplied id, publicCode, status, createdAt or
    // createdByUserId as one rule rather than five separate checks.
    const body = assertOnlyKnownKeys(raw, CREATE_KEYS);

    const code = normalizeCode(body.code, "crm.affiliates.code_invalid");
    const displayName = normalizeDisplayName(body.displayName, "crm.affiliates.display_name_invalid");
    const description = normalizeOptionalText(body.description, "crm.affiliates.description_invalid");
    const defaultAttributionWindowDays =
      body.defaultAttributionWindowDays === undefined
        ? AFFILIATE_WINDOW_DEFAULT
        : normalizeWindowDays(body.defaultAttributionWindowDays, "crm.affiliates.window_invalid");

    let created;
    try {
      created = await prisma.affiliatePartner.create({
        data: {
          code,
          displayName,
          description,
          defaultAttributionWindowDays,
          // The creator comes only from the authenticated session. A body that
          // named someone else was already rejected as an unknown field.
          createdByUserId: actorUserId,
          status: "active",
        },
        select: PARTNER_SELECT,
      });
    } catch (error) {
      asConflict(error, "crm.affiliates.code_conflict");
    }

    await createAuditLog({
      userId: actorUserId,
      action: "AFFILIATE_PARTNER_CREATED",
      entityType: "AffiliatePartner",
      entityId: created.id,
      metadata: { code: created.code, status: created.status },
      request,
    });

    return NextResponse.json(affiliatePartnerSchema.parse(toPartnerDto(created)), {
      status: 201,
      headers,
    });
  } catch (error) {
    return affiliateErrorResponse(error, requestId, headers);
  }
}
