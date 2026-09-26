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
  normalizeWindowDays,
  parseAffiliatePathId,
  type AffiliateStatus,
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
import { affiliatePartnerSchema } from "@/lib/crm/schemas";
import { crmRequestId } from "@/lib/crm/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET   /api/crm/v1/affiliates/partners/[partnerId]
// PATCH /api/crm/v1/affiliates/partners/[partnerId]
//
// PATCH covers both the editable fields and the status transition. `code` is
// absent from the writable set, which is how immutability is enforced: an
// attempt to change it is rejected as an unknown field rather than silently
// ignored.

type RouteContext = { params: Promise<{ partnerId: string }> };

const PATCH_KEYS = [
  "displayName",
  "description",
  "defaultAttributionWindowDays",
  "status",
] as const;

export async function GET(request: Request, context: RouteContext) {
  const requestId = crmRequestId();
  const headers = affiliateHeaders(requestId);

  try {
    await requireAffiliateReader();
    if (new URL(request.url).searchParams.size > 0) {
      throw new AffiliateInputError("crm.affiliates.query_unknown");
    }

    const { partnerId } = await context.params;
    const row = await prisma.affiliatePartner.findUnique({
      where: { id: parseAffiliatePathId(partnerId) },
      select: PARTNER_SELECT,
    });

    // An archived partner is still readable: hiding it would make the history
    // of its campaigns and links unexplainable.
    if (!row) throw new AffiliateNotFoundError("crm.affiliates.not_found");

    return NextResponse.json(affiliatePartnerSchema.parse(toPartnerDto(row)), { headers });
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

    const { partnerId } = await context.params;
    const id = parseAffiliatePathId(partnerId);
    const body = assertOnlyKnownKeys(await readBoundedJson(request), PATCH_KEYS);

    if (Object.keys(body).length === 0) {
      throw new AffiliateInputError("crm.affiliates.body_empty");
    }

    const existing = await prisma.affiliatePartner.findUnique({
      where: { id },
      select: { id: true, code: true, status: true },
    });
    if (!existing) throw new AffiliateNotFoundError("crm.affiliates.not_found");

    const currentStatus = existing.status as AffiliateStatus;

    // Archived is terminal for CONTENT too, not only for status: editing the
    // display name of an archived affiliate would rewrite what a historical
    // report shows without any record that the entity was revived.
    if (currentStatus === "archived") {
      throw new AffiliateInputError("crm.affiliates.archived_immutable");
    }

    const data: Record<string, unknown> = {};
    const changedFields: string[] = [];

    if (body.displayName !== undefined) {
      data.displayName = normalizeDisplayName(body.displayName, "crm.affiliates.display_name_invalid");
      changedFields.push("displayName");
    }
    if (body.description !== undefined) {
      data.description = normalizeOptionalText(body.description, "crm.affiliates.description_invalid");
      changedFields.push("description");
    }
    if (body.defaultAttributionWindowDays !== undefined) {
      data.defaultAttributionWindowDays = normalizeWindowDays(
        body.defaultAttributionWindowDays,
        "crm.affiliates.window_invalid",
      );
      changedFields.push("defaultAttributionWindowDays");
    }

    let nextStatus: AffiliateStatus | undefined;
    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !["active", "paused", "archived"].includes(body.status)) {
        throw new AffiliateInputError("crm.affiliates.status_invalid");
      }
      nextStatus = body.status as AffiliateStatus;
      assertEntityTransition(currentStatus, nextStatus);
      data.status = nextStatus;
      // The paired CHECK in the migration makes status and archivedAt one fact,
      // so they are always written together.
      data.archivedAt = nextStatus === "archived" ? new Date() : null;
      changedFields.push("status");
    }

    // Conditional update: the WHERE re-asserts the status this decision was
    // made against, so two concurrent PATCHes cannot both apply a transition
    // that was only legal from the original state.
    const result = await prisma.affiliatePartner.updateMany({
      where: { id, status: currentStatus },
      data,
    });

    if (result.count === 0) {
      // Someone else moved it first. A stable 409, never a partial write.
      throw new AffiliateInputError("crm.affiliates.status_transition_invalid");
    }

    const updated = await prisma.affiliatePartner.findUniqueOrThrow({
      where: { id },
      select: PARTNER_SELECT,
    });

    await createAuditLog({
      userId: actorUserId,
      action: nextStatus ? "AFFILIATE_PARTNER_STATUS_CHANGED" : "AFFILIATE_PARTNER_UPDATED",
      entityType: "AffiliatePartner",
      entityId: id,
      // Field NAMES and status values only — never the submitted content.
      metadata: {
        code: existing.code,
        changedFields,
        ...(nextStatus ? { previousStatus: currentStatus, newStatus: nextStatus } : {}),
      },
      request,
    });

    return NextResponse.json(affiliatePartnerSchema.parse(toPartnerDto(updated)), { headers });
  } catch (error) {
    return affiliateErrorResponse(error, requestId, headers);
  }
}
