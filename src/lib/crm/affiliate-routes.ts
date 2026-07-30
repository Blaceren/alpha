import { NextResponse } from "next/server";
import { createAuditLog } from "@/lib/audit";
import { validateCsrfToken } from "@/lib/csrf";
import { getSession } from "@/lib/session";
import { CrmAuthError, resolveCrmSession } from "@/lib/crm/session";
import {
  AffiliateConflictError,
  AffiliateForbiddenError,
  AffiliateInputError,
  AffiliateLinkActivationUnavailableError,
  AffiliateNotFoundError,
  AFFILIATE_MAX_BODY_BYTES,
  assertCanManageAffiliates,
  effectiveAvailability,
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

  // The one bespoke code in this phase, because "you asked for active and
  // activation does not exist yet" is a distinct, explainable product state
  // rather than generic bad input.
  if (error instanceof AffiliateLinkActivationUnavailableError) {
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
};

export function toTrackingLinkDto(row: LinkRow): AffiliateTrackingLinkDto {
  const status = row.status as "draft" | "paused" | "archived";
  const parents: ("active" | "paused" | "archived")[] = [
    row.partner.status as "active" | "paused" | "archived",
  ];
  if (row.campaign) parents.push(row.campaign.status as "active" | "paused" | "archived");

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
    effectiveAttributionWindowDays:
      row.attributionWindowDays ?? row.partner.defaultAttributionWindowDays,
    publicRouteState: "not_available_until_afd3b",
    activationState: "unavailable",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

/** Relation selects reused by both the list and detail routes. */
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
} as const;
