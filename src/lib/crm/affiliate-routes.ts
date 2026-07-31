import { NextResponse } from "next/server";
import { createAuditLog } from "@/lib/audit";
import { validateCsrfToken } from "@/lib/csrf";
import { getSession } from "@/lib/session";
import { CrmAuthError, resolveCrmSession } from "@/lib/crm/session";
import { isAffiliateAttributionEnabled } from "@/lib/affiliate/attribution-config";
import { publicAppOrigin } from "@/lib/publicUrl";
import {
  AffiliateAttributionDisabledError,
  AffiliateConflictError,
  AffiliateForbiddenError,
  AffiliateInputError,
  AffiliateNotFoundError,
  AFFILIATE_MAX_BODY_BYTES,
  assertCanManageAffiliates,
  assertCanReadAffiliates,
  describeLinkActivationRefusal,
  effectiveAttributionWindowDays,
  effectiveAvailability,
  type AffiliateStatus,
  type TrackingLinkStatus,
} from "@/lib/crm/affiliates";
import type {
  AffiliateCampaignDto,
  AffiliatePartnerDto,
  AffiliateTrackingLinkDto,
} from "@/lib/crm/schemas";

/**
 * Shared plumbing for the AFD-2 affiliate routes: authentication, CSRF, the
 * error envelope, bounded body reading and row-to-DTO mapping.
 *
 * CSRF IS NEW TO THIS NAMESPACE. No route under /api/crm currently validates a
 * CSRF token — the existing CRM v1 routes rely on the session cookie alone.
 * AFD-2 requires it on every mutation, so these routes enforce it and the CRM
 * client that arrives in AFD-5 must send `x-csrf-token`. The check uses the
 * canonical `validateCsrfToken`, so there is one implementation of the rule.
 */

export type CrmAffiliateSession = Awaited<ReturnType<typeof resolveCrmSession>>;

export function affiliateHeaders(requestId: string) {
  return { "Cache-Control": "no-store", "X-Request-Id": requestId } as const;
}

/**
 * Every failure collapses to `{code, messageKey, requestId}`. No Zod issue, no
 * Prisma error, no SQL, no stack and no row content ever escapes.
 */
export function affiliateErrorResponse(
  error: unknown,
  requestId: string,
  headers: Record<string, string>,
) {
  if (error instanceof CrmAuthError) {
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: error.status, headers },
    );
  }

  if (error instanceof AffiliateForbiddenError) {
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: 403, headers },
    );
  }

  // The one bespoke code in this namespace, because "you asked for active and
  // this deployment has attribution switched off" is a distinct, explainable
  // operational state rather than generic bad input.
  if (error instanceof AffiliateAttributionDisabledError) {
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: 409, headers },
    );
  }

  if (error instanceof AffiliateInputError) {
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: 400, headers },
    );
  }

  if (error instanceof AffiliateNotFoundError) {
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: 404, headers },
    );
  }

  if (error instanceof AffiliateConflictError) {
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: 409, headers },
    );
  }

  return NextResponse.json(
    { code: "internal", messageKey: "crm.affiliates.internal", requestId },
    { status: 500, headers },
  );
}

/** Session + `manage_settings`, in that order, before any lookup or write. */
export async function requireAffiliateManager(): Promise<CrmAffiliateSession> {
  const session = await resolveCrmSession();
  assertCanManageAffiliates(session.effectivePermissions);
  return session;
}

/**
 * AFD-5A — session + the READ gate, for GET routes only.
 *
 * The ordering matters and is the same as the manager gate's: `resolveCrmSession`
 * answers 401 for an anonymous caller and 403 for an authenticated learner with
 * no StaffProfile, and only then is the permission consulted. A caller who fails
 * either step never reaches a database lookup, so no affiliate row is read on
 * behalf of someone not entitled to it.
 *
 * Every mutation deliberately keeps calling `requireAffiliateManager`. Nothing
 * in this function can be reached by a POST or PATCH.
 */
export async function requireAffiliateReader(): Promise<CrmAffiliateSession> {
  const session = await resolveCrmSession();
  assertCanReadAffiliates(session.effectivePermissions);
  return session;
}

/**
 * The authenticated actor as a User id, for `createdByUserId` and audit rows.
 *
 * `session.employeeId` is the StaffProfile cuid, NOT a User id — the two axes
 * are deliberately separate — so the User id is read back from the signed
 * session rather than derived from the employee id. Resolving it after
 * `requireAffiliateManager` means an unauthenticated or unpermitted caller
 * never reaches this lookup.
 */
export async function resolveAffiliateActorUserId(): Promise<number> {
  const session = await getSession();
  if (!session) throw new CrmAuthError(401, "crm.session.unauthenticated");
  return session.userId;
}

/**
 * CSRF for mutations. A failure is audited through the existing owner with the
 * route path only — never the body, the token or the cookie.
 */
export async function requireAffiliateCsrf(request: Request): Promise<void> {
  if (validateCsrfToken(request)) return;

  const url = new URL(request.url);
  await createAuditLog({
    action: "CSRF_INVALID",
    entityType: "API_ROUTE",
    entityId: url.pathname,
    metadata: { path: url.pathname, method: request.method },
    request,
  }).catch(() => undefined);

  throw new AffiliateForbiddenError("crm.affiliates.csrf_invalid");
}

/**
 * Read a JSON body with a hard byte bound applied BEFORE parsing, so an
 * oversized body is refused without ever being materialised as an object.
 */
export async function readBoundedJson(request: Request): Promise<unknown> {
  const raw = await request.text().catch(() => {
    throw new AffiliateInputError("crm.affiliates.body_invalid");
  });

  if (Buffer.byteLength(raw, "utf8") > AFFILIATE_MAX_BODY_BYTES) {
    throw new AffiliateInputError("crm.affiliates.body_too_large");
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AffiliateInputError("crm.affiliates.body_invalid");
  }
}

/* --------------------------------------------------------------- DTO shape */

/**
 * AFD-5A — the creator, projected to an opaque employee id plus a display-safe
 * label and nothing else.
 *
 * The row carries `createdByUserId`, a User id on the LEARNER axis. That id is
 * deliberately never serialized: the CRM's identity axis is the StaffProfile
 * cuid, the two are separate by design, and leaking a User id here would give
 * the CRM a second identifier for the same person. `null` when the creator has
 * no StaffProfile — the affiliate outlives the staff member who created it, and
 * saying "unknown" is better than inventing an actor.
 */
type CreatorRelation = { staffProfile: { id: string; displayName: string } | null } | null;

function toActorDto(createdBy: CreatorRelation) {
  if (!createdBy || !createdBy.staffProfile) return null;
  return {
    employeeId: createdBy.staffProfile.id,
    displayName: createdBy.staffProfile.displayName,
  };
}

type PartnerRow = {
  id: number;
  code: string;
  displayName: string;
  description: string | null;
  status: string;
  defaultAttributionWindowDays: number;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  createdBy: CreatorRelation;
  campaigns: { id: number }[];
  trackingLinks: { status: string }[];
};

export function toPartnerDto(row: PartnerRow): AffiliatePartnerDto {
  const status = row.status as "active" | "paused" | "archived";
  return {
    // Serialized as an opaque decimal string, matching the learner DTOs.
    id: String(row.id),
    code: row.code,
    displayName: row.displayName,
    description: row.description,
    status,
    availability: effectiveAvailability(status, []),
    defaultAttributionWindowDays: row.defaultAttributionWindowDays,
    // Configuration inventory, counted from the rows themselves. Not traffic:
    // see the schema comment on `affiliateInventoryCountsSchema`.
    inventory: {
      campaigns: row.campaigns.length,
      trackingLinks: row.trackingLinks.length,
      activeTrackingLinks: row.trackingLinks.filter((link) => link.status === "active").length,
    },
    createdBy: toActorDto(row.createdBy),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

type CampaignRow = {
  id: number;
  affiliatePartnerId: number;
  code: string;
  displayName: string;
  notes: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  partner: { code: string; status: string };
  createdBy: CreatorRelation;
  trackingLinks: { status: string }[];
};

export function toCampaignDto(row: CampaignRow): AffiliateCampaignDto {
  const status = row.status as "active" | "paused" | "archived";
  return {
    id: String(row.id),
    affiliatePartnerId: String(row.affiliatePartnerId),
    affiliatePartnerCode: row.partner.code,
    code: row.code,
    displayName: row.displayName,
    notes: row.notes,
    status,
    inventory: {
      trackingLinks: row.trackingLinks.length,
      activeTrackingLinks: row.trackingLinks.filter((link) => link.status === "active").length,
    },
    createdBy: toActorDto(row.createdBy),
    // A campaign inherits its partner's unavailability: an active campaign
    // under a paused affiliate is not usable, and saying so is the point.
    availability: effectiveAvailability(status, [
      row.partner.status as "active" | "paused" | "archived",
    ]),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

type LinkRow = {
  id: number;
  affiliatePartnerId: number;
  affiliateCampaignId: number | null;
  publicCode: string;
  displayName: string;
  status: string;
  landingKey: string;
  externalClickParameter: string;
  sub1Parameter: string | null;
  sub2Parameter: string | null;
  sub3Parameter: string | null;
  sub4Parameter: string | null;
  sub5Parameter: string | null;
  attributionWindowDays: number | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  partner: { code: string; status: string; defaultAttributionWindowDays: number };
  campaign: { code: string; status: string } | null;
  createdBy: CreatorRelation;
};

/**
 * AFD-5A — the canonical public tracking URL.
 *
 * The path is derived from the immutable, server-generated `publicCode`; the
 * origin comes from `publicAppOrigin()`, the validated public-origin owner
 * introduced by PUBLICURL-1, which reads configuration ONLY and accepts no
 * request. That is what makes this function un-poisonable: there is no
 * parameter here through which a `Host` or `X-Forwarded-Host` header could
 * reach the result.
 *
 * Returns a null URL rather than a fallback origin when none is configured.
 */
export function buildTrackingLinkPublicUrl(
  publicCode: string,
  env: NodeJS.ProcessEnv = process.env,
): {
  publicPath: string;
  publicUrl: string | null;
  publicUrlUnavailableReason: "public_origin_unavailable" | null;
} {
  const publicPath = `/go/${publicCode}`;
  const origin = publicAppOrigin(env);
  if (origin === null) {
    return { publicPath, publicUrl: null, publicUrlUnavailableReason: "public_origin_unavailable" };
  }
  // Bare: no query string, no example click id, no placeholder. The tracker
  // TEMPLATE the CRM may additionally display is a separate, clearly-labelled
  // rendering and is never what this canonical field carries.
  return { publicPath, publicUrl: `${origin}${publicPath}`, publicUrlUnavailableReason: null };
}

export function toTrackingLinkDto(row: LinkRow): AffiliateTrackingLinkDto {
  const status = row.status as TrackingLinkStatus;
  const partnerStatus = row.partner.status as AffiliateStatus;
  const campaignStatus = row.campaign ? (row.campaign.status as AffiliateStatus) : null;
  const parents: AffiliateStatus[] = [partnerStatus];
  if (campaignStatus !== null) parents.push(campaignStatus);

  // Read once per DTO, never captured at module load, so an operator who flips
  // the switch sees the truth on the next request rather than the next restart.
  const attributionEnabled = isAffiliateAttributionEnabled();
  const availability = effectiveAvailability(status, parents);

  // "Would this link serve traffic right now", answered with the reason.
  const publicRouteState: AffiliateTrackingLinkDto["publicRouteState"] = !attributionEnabled
    ? "feature_disabled"
    : status !== "active"
      ? "not_active"
      : availability === "archived"
        ? "parent_archived"
        : availability === "paused"
          ? "parent_paused"
          : "serving";

  // "Could an operator set this active today", which is a different question:
  // an already-active link is still `available`, because re-activation from
  // paused is the operation that field describes.
  const activationState: AffiliateTrackingLinkDto["activationState"] =
    status === "archived"
      ? "terminal"
      : !attributionEnabled
        ? "feature_disabled"
        : describeLinkActivationRefusal(
              {
                publicCode: row.publicCode,
                landingKey: row.landingKey,
                partnerStatus,
                campaignStatus,
                externalClickParameter: row.externalClickParameter,
                subParameters: [
                  row.sub1Parameter,
                  row.sub2Parameter,
                  row.sub3Parameter,
                  row.sub4Parameter,
                  row.sub5Parameter,
                ],
                attributionWindowDays: row.attributionWindowDays,
                partnerDefaultAttributionWindowDays: row.partner.defaultAttributionWindowDays,
              },
              attributionEnabled,
            ) === null
          ? "available"
          : "blocked";

  return {
    id: String(row.id),
    affiliatePartnerId: String(row.affiliatePartnerId),
    affiliatePartnerCode: row.partner.code,
    affiliateCampaignId: row.affiliateCampaignId === null ? null : String(row.affiliateCampaignId),
    affiliateCampaignCode: row.campaign ? row.campaign.code : null,
    publicCode: row.publicCode,
    displayName: row.displayName,
    status,
    availability: effectiveAvailability(status, parents),
    landingKey: "academy_registration",
    externalClickParameter: row.externalClickParameter,
    subParameters: {
      sub1: row.sub1Parameter,
      sub2: row.sub2Parameter,
      sub3: row.sub3Parameter,
      sub4: row.sub4Parameter,
      sub5: row.sub5Parameter,
    },
    attributionWindowDays: row.attributionWindowDays,
    // Resolved here so a CRM never has to re-implement the inheritance rule.
    effectiveAttributionWindowDays: effectiveAttributionWindowDays(
      row.attributionWindowDays,
      row.partner.defaultAttributionWindowDays,
    ),
    publicRouteState,
    activationState,
    ...buildTrackingLinkPublicUrl(row.publicCode),
    createdBy: toActorDto(row.createdBy),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

/**
 * Relation selects reused by both the list and detail routes.
 *
 * The creator is projected through `staffProfile` so only the CRM identity axis
 * — an opaque cuid and a display name — is ever loaded. `createdByUserId`
 * itself is never selected, which is what stops it reaching a DTO by accident.
 *
 * The inventory counts are selected as narrow child rows rather than Prisma's
 * `_count`, because `activeTrackingLinks` needs the status of each link and one
 * pass over `{status}` answers both link counts without a second aggregate.
 */
const CREATOR_SELECT = {
  select: { staffProfile: { select: { id: true, displayName: true } } },
} as const;

export const PARTNER_SELECT = {
  id: true,
  code: true,
  displayName: true,
  description: true,
  status: true,
  defaultAttributionWindowDays: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  createdBy: CREATOR_SELECT,
  campaigns: { select: { id: true } },
  trackingLinks: { select: { status: true } },
} as const;

export const CAMPAIGN_SELECT = {
  id: true,
  affiliatePartnerId: true,
  code: true,
  displayName: true,
  notes: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  partner: { select: { code: true, status: true } },
  createdBy: CREATOR_SELECT,
  trackingLinks: { select: { status: true } },
} as const;

export const LINK_SELECT = {
  id: true,
  affiliatePartnerId: true,
  affiliateCampaignId: true,
  publicCode: true,
  displayName: true,
  status: true,
  landingKey: true,
  externalClickParameter: true,
  sub1Parameter: true,
  sub2Parameter: true,
  sub3Parameter: true,
  sub4Parameter: true,
  sub5Parameter: true,
  attributionWindowDays: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  partner: { select: { code: true, status: true, defaultAttributionWindowDays: true } },
  campaign: { select: { code: true, status: true } },
  createdBy: CREATOR_SELECT,
} as const;
