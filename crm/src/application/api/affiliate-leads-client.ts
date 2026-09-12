/**
 * AFD-5C2 — the one client for the affiliate lead API.
 *
 * THREE NAMED FUNCTIONS, NOT A GENERIC PROXY. `fetchLeadList` and
 * `fetchLeadDetail` are GET; `revealLeadPii` is POST. There is no
 * `leadRequest(path)` exported and no caller-supplied URL anywhere, so no
 * component can reach a route this file does not name.
 *
 * THE REVEAL IS POST-ONLY AND HAS NO GET FALLBACK. There is exactly one code
 * path that can produce full identity, it hard-codes `method: "POST"`, it sends
 * the canonical CSRF header, and it refuses to send anything at all when a token
 * cannot be obtained. A GET reveal is not something this module declines to do —
 * it is something it cannot express.
 *
 * THE REVEAL IS NEVER PREFETCHED AND NEVER RETRIED. It is called from an
 * explicit confirmation handler and from nowhere else; there is no retry loop,
 * no interval, no `useEffect` that could fire it on mount, and no caching layer
 * that could replay it. One operator action produces one audited reveal.
 *
 * NO AUTHORIZATION HEADER IS EVER CONSTRUCTED. Authentication is the existing
 * host-only CRM session cookie, forwarded by `credentials: "same-origin"` on a
 * relative path. The browser never learns the backend origin, never holds an API
 * token, and no ingress Basic-Auth credential is read or forwarded.
 *
 * NEVER CACHED. `cache: "no-store"` on every request; the backend answers
 * `private, no-store` on every response including errors. Two staff members hold
 * different permissions and see different fields for the same lead, so one
 * shared cache entry would be a disclosure — and a cached reveal would be a
 * disclosure that outlived the operator who was authorised for it.
 */
import { csrfHeaders } from "@/application/api/auth-client";
import {
  leadDetailResponseSchema,
  leadErrorSchema,
  leadListSchema,
  leadRevealResponseSchema,
  type LeadAttributionState,
  type LeadDatePreset,
  type LeadDepositState,
  type LeadDetailResponse,
  type LeadJourneyStage,
  type LeadList,
  type LeadRevealResponse,
  type LeadSort,
} from "@/data/contracts/api/affiliate-leads";

/* ------------------------------------------------------------------- paths */

export const LEADS_BASE = "/api/crm/v1/affiliates/leads";

export const LEAD_LIST_ENDPOINT = LEADS_BASE;

/**
 * The two per-lead paths.
 *
 * The reference is `encodeURIComponent`-ed even though the accepted grammar is
 * `[a-z2-7]` and cannot contain a path separator. The encoding is what keeps
 * that true if a hand-typed URL ever reaches here: a segment containing `/` or
 * `..` becomes an escaped segment the backend refuses with its own 400, rather
 * than a request to a path this client never intended to build.
 */
export function leadDetailEndpoint(leadId: string): string {
  return `${LEADS_BASE}/${encodeURIComponent(leadId)}`;
}

export function leadRevealEndpoint(leadId: string): string {
  return `${LEADS_BASE}/${encodeURIComponent(leadId)}/reveal`;
}

/** Exactly the path shapes this client may call. Asserted by its own test. */
export const LEAD_ENDPOINT_SHAPES = [
  "/api/crm/v1/affiliates/leads",
  "/api/crm/v1/affiliates/leads/{leadId}",
  "/api/crm/v1/affiliates/leads/{leadId}/reveal",
] as const;

export const LEAD_TIMEOUT_MS = 15_000;

/* ---------------------------------------------------------------- outcomes */

/**
 * The closed outcome union.
 *
 * `cursor_invalid` and `cursor_filter_mismatch` are lifted out of the generic
 * invalid-input branch because they are the two 400s the operator can RECOVER
 * from without understanding them: the UI offers "return to the first page"
 * rather than a bare error beside an empty table.
 *
 * `csrf_unavailable` is distinct from `forbidden` for the same reason — one is
 * "you may not do this" and the other is "the token could not be fetched, try
 * again" — and conflating them would tell an authorised administrator they lack
 * a permission they hold.
 */
export type LeadOutcome<T> =
  | { status: "success"; data: T }
  | { status: "cursor_invalid"; messageKey: string; requestId?: string }
  | { status: "invalid_input"; messageKey: string; requestId?: string }
  | { status: "not_found"; messageKey: string; requestId?: string }
  | { status: "unauthenticated"; requestId?: string }
  | { status: "forbidden"; messageKey: string; requestId?: string }
  | { status: "csrf_unavailable" }
  | { status: "misconfigured"; messageKey: string; requestId?: string }
  | { status: "rate_limited"; requestId?: string }
  | { status: "cancelled" }
  | { status: "upstream_unavailable" }
  | { status: "malformed_response" };

export const CURSOR_INVALID_MESSAGE_KEY = "crm.leads.cursor_invalid";
export const CURSOR_MISMATCH_MESSAGE_KEY = "crm.leads.cursor_filter_mismatch";

export interface LeadRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injection seam for tests; production always uses global fetch. */
  fetchImpl?: typeof fetch;
}

/* ----------------------------------------------------------- query building */

/**
 * Every list parameter the backend accepts, and no other.
 *
 * There is NO field here for an email, a name, a Pocket id, a click id, a
 * visitor id, a raw column name or a sort direction of the caller's own
 * devising — so no component can send one. The backend rejects unknown and
 * repeated keys with a 400, so a typo fails loudly rather than being ignored.
 */
export interface LeadListQuery {
  affiliatePartnerId?: string;
  affiliateCampaignId?: string;
  affiliateTrackingLinkId?: string;
  attributionState?: LeadAttributionState;
  journeyStage?: LeadJourneyStage;
  depositState?: LeadDepositState;
  registrationPreset?: LeadDatePreset;
  registrationStartDate?: string;
  registrationEndDate?: string;
  acquisitionPreset?: LeadDatePreset;
  acquisitionStartDate?: string;
  acquisitionEndDate?: string;
  sort?: LeadSort;
  limit?: number;
  cursor?: string;
}

/**
 * ONE fixed key order.
 *
 * Deterministic ordering is not cosmetic: two identical requests must produce
 * byte-identical URLs, or the section hook cannot recognise them as the same
 * request and issues a duplicate.
 */
const QUERY_KEY_ORDER: readonly (keyof LeadListQuery)[] = [
  "affiliatePartnerId",
  "affiliateCampaignId",
  "affiliateTrackingLinkId",
  "attributionState",
  "journeyStage",
  "depositState",
  "registrationPreset",
  "registrationStartDate",
  "registrationEndDate",
  "acquisitionPreset",
  "acquisitionStartDate",
  "acquisitionEndDate",
  "sort",
  "limit",
  "cursor",
];

export function buildLeadQuery(query: LeadListQuery): string {
  const params = new URLSearchParams();
  for (const key of QUERY_KEY_ORDER) {
    const value = query[key];
    // An unset filter is an ABSENT parameter. `attributionState=` is a value the
    // backend must reject, not an unfiltered request.
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/* ------------------------------------------------------------- the request */

function withTimeout(options: LeadRequestOptions) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? LEAD_TIMEOUT_MS);
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, release: () => clearTimeout(timeout) };
}

/** Parse the backend's closed error envelope, tolerating a body that has none. */
async function readError(response: Response): Promise<{ messageKey: string; requestId?: string }> {
  try {
    const parsed = leadErrorSchema.safeParse(await response.json());
    if (parsed.success) {
      return { messageKey: parsed.data.messageKey, requestId: parsed.data.requestId };
    }
  } catch {
    /* fall through to the generic key */
  }
  return { messageKey: "crm.leads.unknown" };
}

/**
 * The single request path for all three calls.
 *
 * A CALLER-CANCELLED REQUEST IS ITS OWN OUTCOME, not an error. The workspace
 * aborts the previous request on every filter change, and reporting that as
 * "backend unavailable" would flash a false failure on each change. The
 * distinction is drawn from the caller's own signal rather than from the
 * exception, because a timeout abort and a supersede abort raise the same one.
 *
 * Status mapping is exhaustive and closed: an unmapped status becomes
 * `upstream_unavailable` rather than being treated as success.
 */
async function leadRequest<T>(
  url: string,
  init: RequestInit,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  options: LeadRequestOptions,
): Promise<LeadOutcome<T>> {
  const { fetchImpl = fetch } = options;
  const timeout = withTimeout(options);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      signal: timeout.signal,
    });
  } catch {
    if (options.signal?.aborted) return { status: "cancelled" };
    return { status: "upstream_unavailable" };
  } finally {
    timeout.release();
  }

  if (response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "malformed_response" };
    }
    const parsed = schema.safeParse(body);
    // A response that fails the strict contract is never rendered partially: an
    // unexpected field on a lead is a privacy question, not a cosmetic one.
    if (!parsed.success) return { status: "malformed_response" };
    return { status: "success", data: parsed.data };
  }

  const { messageKey, requestId } = await readError(response);

  if (response.status === 400) {
    if (messageKey === CURSOR_INVALID_MESSAGE_KEY || messageKey === CURSOR_MISMATCH_MESSAGE_KEY) {
      return { status: "cursor_invalid", messageKey, requestId };
    }
    return { status: "invalid_input", messageKey, requestId };
  }
  if (response.status === 401) return { status: "unauthenticated", requestId };
  if (response.status === 403) return { status: "forbidden", messageKey, requestId };
  if (response.status === 404) return { status: "not_found", messageKey, requestId };
  if (response.status === 409) return { status: "invalid_input", messageKey, requestId };
  if (response.status === 429) return { status: "rate_limited", requestId };
  if (response.status === 500 && messageKey === "crm.analytics.timezone_invalid") {
    return { status: "misconfigured", messageKey, requestId };
  }
  return { status: "upstream_unavailable" };
}

/* ---------------------------------------------------------- the three calls */

export function fetchLeadList(
  query: LeadListQuery,
  options: LeadRequestOptions = {},
): Promise<LeadOutcome<LeadList>> {
  return leadRequest(
    `${LEAD_LIST_ENDPOINT}${buildLeadQuery(query)}`,
    { method: "GET" },
    leadListSchema,
    options,
  );
}

/**
 * One lead, redacted.
 *
 * NO QUERY STRING IS EVER APPENDED. The backend refuses any parameter on this
 * route, and building one here would be a request that always 400s.
 */
export function fetchLeadDetail(
  leadId: string,
  options: LeadRequestOptions = {},
): Promise<LeadOutcome<LeadDetailResponse>> {
  return leadRequest(
    leadDetailEndpoint(leadId),
    { method: "GET" },
    leadDetailResponseSchema,
    options,
  );
}

/**
 * The audited single-lead PII reveal.
 *
 * A MISSING CSRF TOKEN IS A HARD LOCAL FAILURE. If `csrfHeaders()` cannot supply
 * one the reveal is abandoned before any request is made, rather than sent
 * without it — there is no fallback path that reveals identity untokened, and
 * the backend independently refuses one anyway.
 *
 * THE BODY IS EMPTY, DELIBERATELY. The backend accepts at most two bytes and no
 * meaningful content, which is what keeps the "single lead, named in the path"
 * contract from acquiring a batchable input later by accident. There is no id
 * array to send because there is no body to put one in.
 */
export async function revealLeadPii(
  leadId: string,
  options: LeadRequestOptions = {},
): Promise<LeadOutcome<LeadRevealResponse>> {
  const headers = await csrfHeaders({ fetchImpl: options.fetchImpl });
  if (!headers["x-csrf-token"]) return { status: "csrf_unavailable" };

  return leadRequest(
    leadRevealEndpoint(leadId),
    { method: "POST", headers },
    leadRevealResponseSchema,
    options,
  );
}
