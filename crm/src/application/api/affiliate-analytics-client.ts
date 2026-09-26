/**
 * AFD-5C1 — the one client for the affiliate analytics API.
 *
 * SEVEN NAMED FUNCTIONS, NOT A GENERIC PROXY. Each exported function targets one
 * literal backend path from a frozen constant. There is no `fetchAnalytics(path)`
 * and no caller-supplied URL anywhere in this module, so no component can reach
 * a route this file does not name — in particular not
 * `/api/crm/v1/affiliates/leads`, which AFD-5C1 does not consume and which the
 * CRM origin does not even forward.
 *
 * GET ONLY. Every request is built by `analyticsRequest`, which hard-codes
 * `method: "GET"` and passes no body. There is no mutation surface here, so
 * there is no CSRF token to send — CSRF defends state change, and there is none.
 *
 * NO AUTHORIZATION HEADER IS EVER CONSTRUCTED. Authentication is the existing
 * host-only CRM session cookie, forwarded by `credentials: "same-origin"` on a
 * relative path. The browser never learns the backend origin, never holds an API
 * token, and no ingress Basic-Auth credential is read or forwarded — the Next
 * rewrite performs the hop server-side.
 *
 * NEVER CACHED. `cache: "no-store"` on the request and `private, no-store` from
 * the backend. Two staff members can hold different permissions and therefore
 * see different numbers; a shared cache entry would be a disclosure.
 *
 * QUERY BUILDING IS CLOSED. `buildQuery` appends only the keys named in its
 * argument type, and drops `undefined` — so an unset filter is an ABSENT
 * parameter rather than an empty one. The backend rejects unknown and repeated
 * keys with a 400, so a typo here fails loudly instead of being ignored.
 */
import {
  analyticsErrorSchema,
  analyticsFilterOptionsSchema,
  cohortBreakdownSchema,
  cohortSummarySchema,
  cohortTimeseriesSchema,
  eventDateBreakdownSchema,
  eventDateSummarySchema,
  eventDateTimeseriesSchema,
  type AnalyticsFilterOptions,
  type BreakdownDimension,
  type BucketGroup,
  type CohortBreakdown,
  type CohortSummary,
  type CohortTimeseries,
  type DatePreset,
  type EventDateBreakdown,
  type EventDateSummary,
  type EventDateTimeseries,
} from "@/data/contracts/api/affiliate-analytics";

/* ------------------------------------------------------------------- paths */

const ANALYTICS_BASE = "/api/crm/v1/affiliates/analytics";

export const ANALYTICS_FILTERS_ENDPOINT = `${ANALYTICS_BASE}/filters`;
export const ANALYTICS_SUMMARY_ENDPOINT = `${ANALYTICS_BASE}/summary`;
export const ANALYTICS_TIMESERIES_ENDPOINT = `${ANALYTICS_BASE}/timeseries`;
export const ANALYTICS_BREAKDOWN_ENDPOINT = `${ANALYTICS_BASE}/breakdown`;
export const ANALYTICS_COHORT_SUMMARY_ENDPOINT = `${ANALYTICS_BASE}/cohorts/summary`;
export const ANALYTICS_COHORT_TIMESERIES_ENDPOINT = `${ANALYTICS_BASE}/cohorts/timeseries`;
export const ANALYTICS_COHORT_BREAKDOWN_ENDPOINT = `${ANALYTICS_BASE}/cohorts/breakdown`;

/** Exactly the paths this client may call. Asserted by its own test. */
export const ANALYTICS_ENDPOINTS = [
  ANALYTICS_FILTERS_ENDPOINT,
  ANALYTICS_SUMMARY_ENDPOINT,
  ANALYTICS_TIMESERIES_ENDPOINT,
  ANALYTICS_BREAKDOWN_ENDPOINT,
  ANALYTICS_COHORT_SUMMARY_ENDPOINT,
  ANALYTICS_COHORT_TIMESERIES_ENDPOINT,
  ANALYTICS_COHORT_BREAKDOWN_ENDPOINT,
] as const;

export const ANALYTICS_TIMEOUT_MS = 15_000;
export const ANALYTICS_BREAKDOWN_LIMIT = 25;

/* ---------------------------------------------------------------- outcomes */

/**
 * The closed outcome union.
 *
 * `bucket_cap_exceeded` is lifted out of the generic invalid-input branch
 * because it is the one 400 the operator can FIX from the controls in front of
 * them — the UI offers a coarser grouping rather than a bare error.
 */
export type AnalyticsOutcome<T> =
  | { status: "success"; data: T }
  | { status: "bucket_cap_exceeded"; messageKey: string; requestId?: string }
  | { status: "invalid_input"; messageKey: string; requestId?: string }
  | { status: "not_found"; messageKey: string; requestId?: string }
  | { status: "unauthenticated"; requestId?: string }
  | { status: "forbidden"; messageKey: string; requestId?: string }
  | { status: "misconfigured"; messageKey: string; requestId?: string }
  | { status: "rate_limited"; requestId?: string }
  | { status: "cancelled" }
  | { status: "upstream_unavailable" }
  | { status: "malformed_response" };

export const BUCKET_CAP_MESSAGE_KEY = "crm.analytics.bucket_cap_exceeded";

export interface AnalyticsRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injection seam for tests; production always uses global fetch. */
  fetchImpl?: typeof fetch;
}

/* ----------------------------------------------------------- query building */

export interface AnalyticsQuery {
  preset?: DatePreset;
  startDate?: string;
  endDate?: string;
  group?: BucketGroup;
  dimension?: BreakdownDimension;
  cutoffDate?: string;
  affiliatePartnerId?: string;
  affiliateCampaignId?: string;
  affiliateTrackingLinkId?: string;
  includeZeroActivity?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Serialize a query in ONE fixed key order.
 *
 * Deterministic ordering is not cosmetic: two identical requests must produce
 * byte-identical URLs, or the in-flight de-duplication in the workspace cannot
 * recognise them as the same request and the browser cache sees two resources.
 */
const QUERY_KEY_ORDER: readonly (keyof AnalyticsQuery)[] = [
  "preset",
  "startDate",
  "endDate",
  "cutoffDate",
  "group",
  "dimension",
  "affiliatePartnerId",
  "affiliateCampaignId",
  "affiliateTrackingLinkId",
  "includeZeroActivity",
  "limit",
  "offset",
];

export function buildQuery(query: AnalyticsQuery): string {
  const params = new URLSearchParams();
  for (const key of QUERY_KEY_ORDER) {
    const value = query[key];
    // An unset filter is an ABSENT parameter. Sending `affiliatePartnerId=`
    // would be a value the backend must reject, not an unfiltered request.
    if (value === undefined) continue;
    params.set(key, typeof value === "boolean" ? String(value) : String(value));
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/* ------------------------------------------------------------- the request */

function withTimeout(options: AnalyticsRequestOptions) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? ANALYTICS_TIMEOUT_MS);
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, release: () => clearTimeout(timeout) };
}

/** Parse the backend's closed error envelope, tolerating a body that has none. */
async function readError(response: Response): Promise<{ messageKey: string; requestId?: string }> {
  try {
    const parsed = analyticsErrorSchema.safeParse(await response.json());
    if (parsed.success) {
      return { messageKey: parsed.data.messageKey, requestId: parsed.data.requestId };
    }
  } catch {
    /* fall through to the generic key */
  }
  return { messageKey: "crm.analytics.unknown" };
}

/**
 * The single request path for every analytics call.
 *
 * A CALLER-CANCELLED REQUEST IS ITS OWN OUTCOME, not an error. The workspace
 * aborts the previous request on every filter change, and reporting that as
 * "backend unavailable" would flash a false failure on each keystroke. The
 * distinction is drawn from the caller's own signal rather than from the
 * exception, because a timeout abort and a supersede abort raise the same one.
 *
 * Status mapping is exhaustive and closed: an unmapped status becomes
 * `upstream_unavailable` rather than being treated as success.
 */
async function analyticsRequest<T>(
  path: string,
  query: AnalyticsQuery,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  options: AnalyticsRequestOptions,
): Promise<AnalyticsOutcome<T>> {
  const { fetchImpl = fetch } = options;
  const timeout = withTimeout(options);

  let response: Response;
  try {
    response = await fetchImpl(`${path}${buildQuery(query)}`, {
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
    // A response that fails the strict contract is never rendered partially:
    // an unexpected field is a semantic change, not a cosmetic one.
    if (!parsed.success) return { status: "malformed_response" };
    return { status: "success", data: parsed.data };
  }

  const { messageKey, requestId } = await readError(response);

  if (response.status === 400) {
    if (messageKey === BUCKET_CAP_MESSAGE_KEY) {
      return { status: "bucket_cap_exceeded", messageKey, requestId };
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

/* ------------------------------------------------------ the seven callables */

export function fetchAnalyticsFilters(
  query: Pick<AnalyticsQuery, "affiliatePartnerId" | "affiliateCampaignId">,
  options: AnalyticsRequestOptions = {},
): Promise<AnalyticsOutcome<AnalyticsFilterOptions>> {
  return analyticsRequest(
    ANALYTICS_FILTERS_ENDPOINT,
    query,
    analyticsFilterOptionsSchema,
    options,
  );
}

export function fetchEventDateSummary(
  query: AnalyticsQuery,
  options: AnalyticsRequestOptions = {},
): Promise<AnalyticsOutcome<EventDateSummary>> {
  return analyticsRequest(ANALYTICS_SUMMARY_ENDPOINT, query, eventDateSummarySchema, options);
}

export function fetchEventDateTimeseries(
  query: AnalyticsQuery,
  options: AnalyticsRequestOptions = {},
): Promise<AnalyticsOutcome<EventDateTimeseries>> {
  return analyticsRequest(
    ANALYTICS_TIMESERIES_ENDPOINT,
    query,
    eventDateTimeseriesSchema,
    options,
  );
}

export function fetchEventDateBreakdown(
  query: AnalyticsQuery,
  options: AnalyticsRequestOptions = {},
): Promise<AnalyticsOutcome<EventDateBreakdown>> {
  return analyticsRequest(
    ANALYTICS_BREAKDOWN_ENDPOINT,
    query,
    eventDateBreakdownSchema,
    options,
  );
}

export function fetchCohortSummary(
  query: AnalyticsQuery,
  options: AnalyticsRequestOptions = {},
): Promise<AnalyticsOutcome<CohortSummary>> {
  return analyticsRequest(
    ANALYTICS_COHORT_SUMMARY_ENDPOINT,
    query,
    cohortSummarySchema,
    options,
  );
}

export function fetchCohortTimeseries(
  query: AnalyticsQuery,
  options: AnalyticsRequestOptions = {},
): Promise<AnalyticsOutcome<CohortTimeseries>> {
  return analyticsRequest(
    ANALYTICS_COHORT_TIMESERIES_ENDPOINT,
    query,
    cohortTimeseriesSchema,
    options,
  );
}

export function fetchCohortBreakdown(
  query: AnalyticsQuery,
  options: AnalyticsRequestOptions = {},
): Promise<AnalyticsOutcome<CohortBreakdown>> {
  return analyticsRequest(
    ANALYTICS_COHORT_BREAKDOWN_ENDPOINT,
    query,
    cohortBreakdownSchema,
    options,
  );
}
