/**
 * AFD-5A — the one client for the affiliate inventory API.
 *
 * Relative paths only. The browser never learns the backend origin: the Next
 * rewrite maps these exact paths server-side, which keeps the session cookie
 * host-only and removes any need for CORS.
 *
 * THE GENERATED TRACKING URL IS NEVER BUILT HERE. `publicUrl` arrives already
 * assembled by the backend from its validated public origin. There is
 * deliberately no `location.host`, no `window.location.origin`, no
 * `document.baseURI` and no string concatenation of an origin anywhere in this
 * module — a URL built from the browser's current host would be exactly the
 * redirect gadget the backend's origin owner exists to prevent.
 *
 * Every failure maps to a closed outcome. There is no fallback data: if a
 * response cannot be validated, the affiliate surface must not render it.
 */
import {
  affiliateCampaignListSchema,
  affiliateCampaignSchema,
  affiliateErrorSchema,
  affiliatePartnerListSchema,
  affiliatePartnerSchema,
  affiliateTrackingLinkListSchema,
  affiliateTrackingLinkSchema,
  type AffiliateCampaign,
  type AffiliateCampaignList,
  type AffiliatePartner,
  type AffiliatePartnerList,
  type AffiliateTrackingLink,
  type AffiliateTrackingLinkList,
} from "@/data/contracts/api/affiliates";
import { csrfHeaders } from "@/application/api/auth-client";

export const AFFILIATE_PARTNERS_ENDPOINT = "/api/crm/v1/affiliates/partners";
export const AFFILIATE_CAMPAIGNS_ENDPOINT = "/api/crm/v1/affiliates/campaigns";
export const AFFILIATE_LINKS_ENDPOINT = "/api/crm/v1/affiliates/tracking-links";

export const AFFILIATE_TIMEOUT_MS = 8_000;
export const AFFILIATE_DEFAULT_LIMIT = 25;
export const AFFILIATE_MAX_LIMIT = 100;
export const AFFILIATE_MAX_SEARCH_LENGTH = 100;

/**
 * Stable backend reasons, carried through so the UI can explain a refusal in
 * its own words. `messageKey` is NEVER rendered as user-facing copy — it is a
 * lookup key into Russian strings the CRM owns, and an unrecognised key falls
 * back to a generic message rather than being printed.
 */
export type AffiliateOutcome<T> =
  | { status: "success"; data: T }
  | { status: "invalid_input"; messageKey: string; requestId?: string }
  | { status: "conflict"; messageKey: string; requestId?: string }
  | { status: "not_found"; messageKey: string; requestId?: string }
  | { status: "unauthenticated"; requestId?: string }
  | { status: "forbidden"; messageKey: string; requestId?: string }
  | { status: "rate_limited"; requestId?: string }
  | { status: "upstream_unavailable" }
  | { status: "malformed_response" };

export interface AffiliateRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injection seam for tests; production always uses global fetch. */
  fetchImpl?: typeof fetch;
}

function withTimeout(options: AffiliateRequestOptions) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? AFFILIATE_TIMEOUT_MS);
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, release: () => clearTimeout(timeout) };
}

/** Parse the backend's closed error envelope, tolerating a body that has none. */
async function readError(response: Response): Promise<{ messageKey: string; requestId?: string }> {
  try {
    const parsed = affiliateErrorSchema.safeParse(await response.json());
    if (parsed.success) {
      return { messageKey: parsed.data.messageKey, requestId: parsed.data.requestId };
    }
  } catch {
    /* fall through to the generic key */
  }
  return { messageKey: "crm.affiliates.unknown" };
}

/**
 * The single request path for every affiliate call.
 *
 * Status mapping is exhaustive and closed: an unmapped status becomes
 * `upstream_unavailable` rather than being treated as success.
 */
/**
 * EXPORTED FOR THE COMMERCIAL CLIENT (AFFILIATE-PLATFORM-V1).
 *
 * The commercial staff surfaces speak the same closed error envelope and need
 * the same exhaustive status mapping, the same timeout and the same
 * "never render an unvalidated body" rule. A second copy of this function would
 * be a second place for that mapping to drift, and the mapping is what decides
 * whether a 403 renders as "forbidden" or as data.
 */
export async function request<T>(
  path: string,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  init: RequestInit,
  options: AffiliateRequestOptions,
): Promise<AffiliateOutcome<T>> {
  const { fetchImpl = fetch } = options;
  const timeout = withTimeout(options);

  let response: Response;
  try {
    response = await fetchImpl(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      signal: timeout.signal,
    });
  } catch {
    // Network failure, timeout or abort. Never a partial render.
    return { status: "upstream_unavailable" };
  } finally {
    timeout.release();
  }

  if (response.status === 401) return { status: "unauthenticated", ...(await readError(response)) };
  if (response.status === 403) return { status: "forbidden", ...(await readError(response)) };
  if (response.status === 404) return { status: "not_found", ...(await readError(response)) };
  if (response.status === 409) return { status: "conflict", ...(await readError(response)) };
  if (response.status === 429) return { status: "rate_limited", ...(await readError(response)) };
  if (response.status === 400) return { status: "invalid_input", ...(await readError(response)) };
  if (!response.ok) return { status: "upstream_unavailable" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "malformed_response" };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return { status: "malformed_response" };
  return { status: "success", data: parsed.data };
}

/** GET with no body and no CSRF — reads are never state-changing. */
function get<T>(
  path: string,
  schema: Parameters<typeof request<T>>[1],
  options: AffiliateRequestOptions,
) {
  return request<T>(path, schema, { method: "GET" }, options);
}

/**
 * POST/PATCH with the canonical CSRF header.
 *
 * A missing token is a HARD FAILURE, not a silent unauthenticated attempt: if
 * `csrfHeaders()` cannot supply one, the mutation is abandoned locally rather
 * than sent without it. There is no fallback path that mutates without a token,
 * and the backend independently refuses one anyway.
 */
/**
 * EXPORTED FOR THE COMMERCIAL CLIENT, for the same reason `request` is: the
 * hard-fail-on-missing-CSRF rule must have exactly one implementation. A second
 * copy is a second chance for somebody to add a fallback that mutates without a
 * token.
 */
export async function mutate<T>(
  path: string,
  schema: Parameters<typeof request<T>>[1],
  method: "POST" | "PATCH",
  body: unknown,
  options: AffiliateRequestOptions,
): Promise<AffiliateOutcome<T>> {
  const headers = await csrfHeaders({ fetchImpl: options.fetchImpl });
  if (!headers["x-csrf-token"]) {
    return { status: "forbidden", messageKey: "crm.affiliates.csrf_unavailable" };
  }

  return request<T>(
    path,
    schema,
    {
      method,
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    options,
  );
}

/* ------------------------------------------------------------- list queries */

export interface AffiliateListInput {
  limit?: number;
  offset?: number;
  status?: string;
  search?: string;
  affiliatePartnerId?: string;
  affiliateCampaignId?: string;
}

/**
 * Serialize only the keys the backend accepts. Anything else — sort, page,
 * order, employeeId, permissions, a date range — is structurally impossible to
 * send, because nothing else is ever written here. The backend rejects unknown
 * and duplicated query keys outright, so this stays deliberately narrow.
 */
export function buildAffiliateQuery(input: AffiliateListInput): string {
  const params = new URLSearchParams();

  const limit = Math.min(
    AFFILIATE_MAX_LIMIT,
    Math.max(1, Math.trunc(input.limit ?? AFFILIATE_DEFAULT_LIMIT)),
  );
  params.set("limit", String(limit));

  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  if (offset > 0) params.set("offset", String(offset));

  if (input.status) params.set("status", input.status);

  const search = input.search?.trim() ?? "";
  if (search.length > 0) params.set("search", search.slice(0, AFFILIATE_MAX_SEARCH_LENGTH));

  if (input.affiliatePartnerId) params.set("affiliatePartnerId", input.affiliatePartnerId);
  if (input.affiliateCampaignId) params.set("affiliateCampaignId", input.affiliateCampaignId);

  return params.toString();
}

export function fetchAffiliatePartners(
  input: AffiliateListInput = {},
  options: AffiliateRequestOptions = {},
): Promise<AffiliateOutcome<AffiliatePartnerList>> {
  return get(
    `${AFFILIATE_PARTNERS_ENDPOINT}?${buildAffiliateQuery(input)}`,
    affiliatePartnerListSchema,
    options,
  );
}

export function fetchAffiliatePartner(
  partnerId: string,
  options: AffiliateRequestOptions = {},
): Promise<AffiliateOutcome<AffiliatePartner>> {
  return get(
    `${AFFILIATE_PARTNERS_ENDPOINT}/${encodeURIComponent(partnerId)}`,
    affiliatePartnerSchema,
    options,
  );
}

export function fetchAffiliateCampaigns(
  input: AffiliateListInput = {},
  options: AffiliateRequestOptions = {},
): Promise<AffiliateOutcome<AffiliateCampaignList>> {
  return get(
    `${AFFILIATE_CAMPAIGNS_ENDPOINT}?${buildAffiliateQuery(input)}`,
    affiliateCampaignListSchema,
    options,
  );
}

export function fetchAffiliateTrackingLinks(
  input: AffiliateListInput = {},
  options: AffiliateRequestOptions = {},
): Promise<AffiliateOutcome<AffiliateTrackingLinkList>> {
  return get(
    `${AFFILIATE_LINKS_ENDPOINT}?${buildAffiliateQuery(input)}`,
    affiliateTrackingLinkListSchema,
    options,
  );
}

export function fetchAffiliateTrackingLink(
  linkId: string,
  options: AffiliateRequestOptions = {},
): Promise<AffiliateOutcome<AffiliateTrackingLink>> {
  return get(
    `${AFFILIATE_LINKS_ENDPOINT}/${encodeURIComponent(linkId)}`,
    affiliateTrackingLinkSchema,
    options,
  );
}

/* ---------------------------------------------------------------- mutations */

export interface CreatePartnerInput {
  code: string;
  displayName: string;
  description?: string | null;
  defaultAttributionWindowDays?: number;
}

export function createAffiliatePartner(
  input: CreatePartnerInput,
  options: AffiliateRequestOptions = {},
): Promise<AffiliateOutcome<AffiliatePartner>> {
  return mutate(AFFILIATE_PARTNERS_ENDPOINT, affiliatePartnerSchema, "POST", input, options);
}

/**
 * Partner edit and status change share one route.
 *
 * `code` is absent from this type on purpose: the backend rejects it as an
 * unknown field, and the CRM must not offer an affordance the contract refuses.
 */
export interface UpdatePartnerInput {
  displayName?: string;
  description?: string | null;
  defaultAttributionWindowDays?: number;
  status?: "active" | "paused" | "archived";
}

export function updateAffiliatePartner(
  partnerId: string,
  input: UpdatePartnerInput,
  options: AffiliateRequestOptions = {},
): Promise<AffiliateOutcome<AffiliatePartner>> {
  return mutate(
    `${AFFILIATE_PARTNERS_ENDPOINT}/${encodeURIComponent(partnerId)}`,
    affiliatePartnerSchema,
    "PATCH",
    input,
    options,
  );
}

export interface CreateCampaignInput {
  affiliatePartnerId: string;
  code: string;
  displayName: string;
  notes?: string | null;
}

export function createAffiliateCampaign(
  input: CreateCampaignInput,
  options: AffiliateRequestOptions = {},
): Promise<AffiliateOutcome<AffiliateCampaign>> {
  return mutate(AFFILIATE_CAMPAIGNS_ENDPOINT, affiliateCampaignSchema, "POST", input, options);
}

export interface UpdateCampaignInput {
  displayName?: string;
  notes?: string | null;
  status?: "active" | "paused" | "archived";
}

export function updateAffiliateCampaign(
  campaignId: string,
  input: UpdateCampaignInput,
  options: AffiliateRequestOptions = {},
): Promise<AffiliateOutcome<AffiliateCampaign>> {
  return mutate(
    `${AFFILIATE_CAMPAIGNS_ENDPOINT}/${encodeURIComponent(campaignId)}`,
    affiliateCampaignSchema,
    "PATCH",
    input,
    options,
  );
}

/**
 * Tracking-link creation.
 *
 * NOTE WHAT IS ABSENT AND CANNOT BE ADDED HERE: no `publicCode` (the backend is
 * its only producer), no `url`, no `destination`, no `redirectUrl`, no Pocket
 * target, no secret and no query template. `landingKey` is a fixed server-owned
 * literal, not a free-text field. A link is described entirely by which
 * parameters it accepts — never by where it points.
 */
export interface CreateTrackingLinkInput {
  affiliatePartnerId: string;
  affiliateCampaignId?: string | null;
  displayName: string;
  landingKey?: "academy_registration";
  externalClickParameter?: string;
  sub1Parameter?: string | null;
  sub2Parameter?: string | null;
  sub3Parameter?: string | null;
  sub4Parameter?: string | null;
  sub5Parameter?: string | null;
  attributionWindowDays?: number | null;
}

export function createAffiliateTrackingLink(
  input: CreateTrackingLinkInput,
  options: AffiliateRequestOptions = {},
): Promise<AffiliateOutcome<AffiliateTrackingLink>> {
  return mutate(AFFILIATE_LINKS_ENDPOINT, affiliateTrackingLinkSchema, "POST", input, options);
}

export interface UpdateTrackingLinkInput {
  displayName?: string;
  externalClickParameter?: string;
  sub1Parameter?: string | null;
  sub2Parameter?: string | null;
  sub3Parameter?: string | null;
  sub4Parameter?: string | null;
  sub5Parameter?: string | null;
  attributionWindowDays?: number | null;
  status?: "draft" | "active" | "paused" | "archived";
}

export function updateAffiliateTrackingLink(
  linkId: string,
  input: UpdateTrackingLinkInput,
  options: AffiliateRequestOptions = {},
): Promise<AffiliateOutcome<AffiliateTrackingLink>> {
  return mutate(
    `${AFFILIATE_LINKS_ENDPOINT}/${encodeURIComponent(linkId)}`,
    affiliateTrackingLinkSchema,
    "PATCH",
    input,
    options,
  );
}
