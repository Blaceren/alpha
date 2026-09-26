/**
 * G4-GROWTH — the one client for the Growth API.
 *
 * FIVE NAMED FUNCTIONS, NOT A GENERIC PROXY. Each targets one literal backend
 * path from a frozen constant. There is no `fetchGrowth(path)` and no
 * caller-supplied URL anywhere in this module, so no component can reach a route
 * this file does not name — in particular not the Pocket postback intake, which
 * the CRM origin does not forward at all.
 *
 * GET ONLY. Every request hard-codes `method: "GET"` and sends no body. There is
 * no mutation surface here, so there is no CSRF token to send.
 *
 * NO AUTHORIZATION HEADER IS EVER CONSTRUCTED. Authentication is the existing
 * host-only CRM session cookie, forwarded by `credentials: "same-origin"` on a
 * relative path. The browser never learns the backend origin and never holds a
 * token.
 *
 * NEVER CACHED. `cache: "no-store"`, and the backend answers `private, no-store`.
 * Two staff members can hold different permissions and see different numbers.
 *
 * Modelled on `affiliate-analytics-client.ts` deliberately — §57 asks for
 * consistency with existing conventions rather than a parallel architecture.
 */
import {
  growthAcquisitionSchema,
  growthErrorSchema,
  growthFunnelSchema,
  growthIngressHealthSchema,
  growthOverviewSchema,
  growthPocketConversionsSchema,
  type GrowthAcquisition,
  type GrowthFunnel,
  type GrowthIngressHealth,
  type GrowthOverview,
  type GrowthPocketConversions,
} from "@/data/contracts/api/growth";

const GROWTH_BASE = "/api/crm/v1/growth";

export const GROWTH_OVERVIEW_ENDPOINT = `${GROWTH_BASE}/overview`;
export const GROWTH_FUNNEL_ENDPOINT = `${GROWTH_BASE}/funnel`;
export const GROWTH_ACQUISITION_ENDPOINT = `${GROWTH_BASE}/acquisition`;
export const GROWTH_POCKET_CONVERSIONS_ENDPOINT = `${GROWTH_BASE}/pocket-conversions`;
export const GROWTH_INGRESS_HEALTH_ENDPOINT = `${GROWTH_BASE}/ingress-health`;

/** Exactly the paths this client may call. Asserted by its own test. */
export const GROWTH_ENDPOINTS = [
  GROWTH_OVERVIEW_ENDPOINT,
  GROWTH_FUNNEL_ENDPOINT,
  GROWTH_ACQUISITION_ENDPOINT,
  GROWTH_POCKET_CONVERSIONS_ENDPOINT,
  GROWTH_INGRESS_HEALTH_ENDPOINT,
] as const;

export const GROWTH_TIMEOUT_MS = 15_000;

export type GrowthOutcome<T> =
  | { status: "success"; data: T }
  | { status: "invalid_input"; messageKey: string; requestId?: string }
  | { status: "unauthenticated"; requestId?: string }
  | { status: "forbidden"; messageKey: string; requestId?: string }
  | { status: "not_found"; messageKey: string; requestId?: string }
  | { status: "misconfigured"; messageKey: string; requestId?: string }
  | { status: "rate_limited"; requestId?: string }
  | { status: "cancelled" }
  | { status: "upstream_unavailable" }
  | { status: "malformed_response" };

export interface GrowthRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injection seam for tests; production always uses global fetch. */
  fetchImpl?: typeof fetch;
}

export interface GrowthQuery {
  preset?: string;
  startDate?: string;
  endDate?: string;
  affiliatePartnerId?: string;
  affiliateCampaignId?: string;
  trackingLinkId?: string;
  dimension?: string;
  maxLevel?: number;
  limit?: number;
}

/**
 * One fixed key order, so two identical requests produce byte-identical URLs.
 * Not cosmetic: in-flight de-duplication and the browser cache both key on the
 * URL string.
 */
const QUERY_KEY_ORDER: readonly (keyof GrowthQuery)[] = [
  "preset",
  "startDate",
  "endDate",
  "affiliatePartnerId",
  "affiliateCampaignId",
  "trackingLinkId",
  "dimension",
  "maxLevel",
  "limit",
];

export function buildGrowthQuery(query: GrowthQuery): string {
  const params = new URLSearchParams();
  for (const key of QUERY_KEY_ORDER) {
    const value = query[key];
    // An unset filter is an ABSENT parameter. `affiliatePartnerId=` would be a
    // value the backend must reject, not an unfiltered request.
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

function withTimeout(options: GrowthRequestOptions) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? GROWTH_TIMEOUT_MS);
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, release: () => clearTimeout(timeout) };
}

async function readError(response: Response): Promise<{ messageKey: string; requestId?: string }> {
  try {
    const parsed = growthErrorSchema.safeParse(await response.json());
    if (parsed.success) {
      return { messageKey: parsed.data.messageKey, requestId: parsed.data.requestId };
    }
  } catch {
    /* fall through to the generic key */
  }
  return { messageKey: "crm.growth.unknown" };
}

/**
 * The single request path for every Growth call.
 *
 * A CALLER-CANCELLED REQUEST IS ITS OWN OUTCOME, not an error — the workspace
 * aborts the previous request on every filter change, and reporting that as
 * "backend unavailable" would flash a false failure on each interaction.
 *
 * Status mapping is exhaustive and closed: an unmapped status becomes
 * `upstream_unavailable` rather than being treated as success.
 */
async function growthRequest<T>(
  path: string,
  query: GrowthQuery,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  options: GrowthRequestOptions,
): Promise<GrowthOutcome<T>> {
  const { fetchImpl = fetch } = options;
  const timeout = withTimeout(options);

  let response: Response;
  try {
    response = await fetchImpl(`${path}${buildGrowthQuery(query)}`, {
      method: "GET",
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
    // A response failing the strict contract is never rendered partially: a
    // half-drawn funnel looks exactly like a complete one.
    if (!parsed.success) return { status: "malformed_response" };
    return { status: "success", data: parsed.data };
  }

  const { messageKey, requestId } = await readError(response);

  if (response.status === 400) return { status: "invalid_input", messageKey, requestId };
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

export function fetchGrowthOverview(
  query: GrowthQuery,
  options: GrowthRequestOptions = {},
): Promise<GrowthOutcome<GrowthOverview>> {
  return growthRequest(GROWTH_OVERVIEW_ENDPOINT, query, growthOverviewSchema, options);
}

export function fetchGrowthFunnel(
  query: GrowthQuery,
  options: GrowthRequestOptions = {},
): Promise<GrowthOutcome<GrowthFunnel>> {
  return growthRequest(GROWTH_FUNNEL_ENDPOINT, query, growthFunnelSchema, options);
}

export function fetchGrowthAcquisition(
  query: GrowthQuery,
  options: GrowthRequestOptions = {},
): Promise<GrowthOutcome<GrowthAcquisition>> {
  return growthRequest(GROWTH_ACQUISITION_ENDPOINT, query, growthAcquisitionSchema, options);
}

export function fetchGrowthPocketConversions(
  query: GrowthQuery,
  options: GrowthRequestOptions = {},
): Promise<GrowthOutcome<GrowthPocketConversions>> {
  return growthRequest(
    GROWTH_POCKET_CONVERSIONS_ENDPOINT,
    query,
    growthPocketConversionsSchema,
    options,
  );
}

export function fetchGrowthIngressHealth(
  query: GrowthQuery,
  options: GrowthRequestOptions = {},
): Promise<GrowthOutcome<GrowthIngressHealth>> {
  return growthRequest(
    GROWTH_INGRESS_HEALTH_ENDPOINT,
    query,
    growthIngressHealthSchema,
    options,
  );
}
