/**
 * AFD-5D2 — the one client for the Curie Atlas analysis endpoint.
 *
 * ONE NAMED FUNCTION, ONE LITERAL PATH. There is no `fetchAtlas(path)` and no
 * caller-supplied URL anywhere in this module, so no component can reach a route
 * this file does not name — in particular not the lead routes, which this
 * workspace has no business calling and which it never imports.
 *
 * POST, AND THEREFORE CSRF. This is the first affiliate-analytics surface that
 * is not a GET. The endpoint is a READ that uses POST because its request is a
 * mode, two period shapes, a cutoff, three filters, a grouping and a dimension —
 * as a query string that is a URL nobody can review. The backend requires a CSRF
 * token anyway, because the affiliate namespace's rule is "POST validates a
 * token" and a read-only exception is the precedent that later gets copied to a
 * route that does write.
 *
 * A MISSING CSRF TOKEN IS A HARD LOCAL FAILURE. If `csrfHeaders()` cannot supply
 * one the analysis is abandoned before any request is made, rather than sent
 * without it — the backend refuses it independently, and a request that is
 * guaranteed to 403 is not worth issuing.
 *
 * NEVER CACHED. `cache: "no-store"` on the request and `private, no-store` from
 * the backend. Two staff members can hold different permissions and therefore
 * see different numbers; a shared cache entry would be a disclosure.
 *
 * THIS CLIENT WRITES NOTHING AND PERSISTS NOTHING. It does not touch
 * localStorage, sessionStorage, IndexedDB, cookies or the URL, and the report it
 * returns is handed to the caller's memory and nowhere else.
 */
import { csrfHeaders } from "@/application/api/auth-client";
import {
  ATLAS_BODY_KEY_ORDER,
  atlasErrorSchema,
  atlasReportSchema,
  type AtlasReport,
  type AtlasRequestBody,
} from "@/data/contracts/api/curie-atlas";

/* ------------------------------------------------------------------- path */

/**
 * The single backend path this client may call.
 *
 * It must also be present in `PROXIED_PATHS` in `next.config.mjs`, or the CRM
 * origin does not forward it. `src/config/next-rewrites.test.ts` asserts the
 * two agree.
 */
export const ATLAS_ANALYSIS_ENDPOINT = "/api/crm/v1/affiliates/analytics/analysis";

/** Exactly the paths this client may call. Asserted by its own test. */
export const ATLAS_ENDPOINTS = [ATLAS_ANALYSIS_ENDPOINT] as const;

/**
 * Deliberately generous relative to the analytics GETs (8 s).
 *
 * The analysis endpoint runs the same loaders as summary, timeseries AND
 * breakdown, then the rule set, in one request. Timing it out at the
 * single-aggregate budget would report a healthy backend as unavailable.
 */
export const ATLAS_TIMEOUT_MS = 20_000;

/* ---------------------------------------------------------------- outcomes */

/**
 * Stable backend reasons, carried through so the UI can explain a refusal in
 * its own words. `messageKey` is NEVER rendered as user-facing copy — it is a
 * lookup key into Russian strings the CRM owns, and an unrecognised key falls
 * back to a generic message rather than being printed.
 *
 * `contract_violation` is SEPARATE from `malformed_response` on purpose. A
 * malformed body is a transport or version accident; a contract violation is a
 * response that parsed as JSON and asserted something this release refuses to
 * render — `modelInvoked: true`, an `opportunities` collection, a different
 * agent. Collapsing them would tell an operator "try again" when the correct
 * message is "this build will not display that".
 */
export type AtlasOutcome =
  | { status: "success"; data: AtlasReport }
  | { status: "invalid_input"; messageKey: string; requestId?: string }
  | { status: "unauthenticated"; requestId?: string }
  | { status: "forbidden"; messageKey: string; requestId?: string }
  | { status: "not_found"; messageKey: string; requestId?: string }
  | { status: "rate_limited"; requestId?: string }
  | { status: "csrf_unavailable" }
  | { status: "timeout" }
  | { status: "cancelled" }
  | { status: "upstream_unavailable" }
  | { status: "malformed_response" }
  | { status: "contract_violation"; reason: AtlasContractViolation };

/** Why a syntactically valid response was refused. */
export type AtlasContractViolation =
  | "model_invoked"
  | "legacy_opportunities_field"
  | "unexpected_agent"
  | "schema_mismatch";

export interface AtlasRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injection seam for tests; production always uses global fetch. */
  fetchImpl?: typeof fetch;
}

/* ------------------------------------------------------------ body building */

/**
 * Serialize the body in ONE fixed key order, dropping unset keys.
 *
 * An unset filter is an ABSENT key rather than an empty one: the backend
 * rejects unknown and empty-valued parameters, so sending
 * `affiliatePartnerId: ""` would be a request that always 400s.
 *
 * Deterministic ordering is not cosmetic. Two identical selections must produce
 * a byte-identical body, which is what lets the workspace recognise a repeat
 * request and what makes "the same request produces the same visible result"
 * something a test can assert on the wire rather than on the screen.
 */
export function buildAtlasBody(body: AtlasRequestBody): string {
  const ordered: Record<string, unknown> = {};
  for (const key of ATLAS_BODY_KEY_ORDER) {
    const value = body[key];
    if (value === undefined || value === "") continue;
    ordered[key] = value;
  }
  return JSON.stringify(ordered);
}

/* --------------------------------------------------------------- the request */

function withTimeout(options: AtlasRequestOptions) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? ATLAS_TIMEOUT_MS);
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return {
    signal: controller.signal,
    release: () => clearTimeout(timeout),
    timedOut: () => timedOut,
  };
}

/** Parse the backend's closed error envelope, tolerating a body that has none. */
async function readError(
  response: Response,
): Promise<{ messageKey: string; requestId?: string }> {
  try {
    const parsed = atlasErrorSchema.safeParse(await response.json());
    if (parsed.success) {
      return { messageKey: parsed.data.messageKey, requestId: parsed.data.requestId };
    }
  } catch {
    /* fall through to the generic key */
  }
  return { messageKey: "crm.analysis.unknown" };
}

/**
 * Classify a body that is JSON but not a valid report.
 *
 * The specific violations are detected BEFORE the schema verdict is reported so
 * the operator learns which rule was broken. `atlasReportSchema` would reject
 * all three anyway; this only turns "malformed" into a sentence somebody can
 * act on.
 */
function classifyViolation(body: unknown): AtlasContractViolation {
  if (body === null || typeof body !== "object") return "schema_mismatch";
  const record = body as Record<string, unknown>;

  if ("opportunities" in record) return "legacy_opportunities_field";

  const engine = record.engine;
  if (engine !== null && typeof engine === "object") {
    if ((engine as Record<string, unknown>).modelInvoked === true) return "model_invoked";
  }

  const agent = record.agent;
  if (agent !== null && typeof agent === "object") {
    const { code, version } = agent as Record<string, unknown>;
    if (code !== "curie_atlas" || version !== "1.0.0") return "unexpected_agent";
  } else if ("agent" in record || "engine" in record) {
    return "unexpected_agent";
  }

  return "schema_mismatch";
}

/**
 * Run one Curie Atlas analysis.
 *
 * A CALLER-CANCELLED REQUEST IS ITS OWN OUTCOME, not an error: the workspace
 * aborts on teardown, and reporting that as "backend unavailable" would flash a
 * false failure while navigating away. A TIMEOUT is likewise distinct from an
 * unreachable backend — the operator's next step differs.
 *
 * Status mapping is exhaustive and closed: an unmapped status becomes
 * `upstream_unavailable` rather than being treated as success.
 */
export async function runAtlasAnalysis(
  body: AtlasRequestBody,
  options: AtlasRequestOptions = {},
): Promise<AtlasOutcome> {
  const { fetchImpl = fetch } = options;

  const headers = await csrfHeaders({ fetchImpl });
  if (!headers["x-csrf-token"]) return { status: "csrf_unavailable" };

  const timeout = withTimeout(options);

  let response: Response;
  try {
    response = await fetchImpl(ATLAS_ANALYSIS_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { ...headers, "content-type": "application/json" },
      body: buildAtlasBody(body),
      signal: timeout.signal,
    });
  } catch {
    if (options.signal?.aborted) return { status: "cancelled" };
    if (timeout.timedOut()) return { status: "timeout" };
    return { status: "upstream_unavailable" };
  } finally {
    timeout.release();
  }

  if (response.ok) {
    let parsedBody: unknown;
    try {
      parsedBody = await response.json();
    } catch {
      return { status: "malformed_response" };
    }

    const parsed = atlasReportSchema.safeParse(parsedBody);
    if (!parsed.success) {
      return { status: "contract_violation", reason: classifyViolation(parsedBody) };
    }
    return { status: "success", data: parsed.data };
  }

  const { messageKey, requestId } = await readError(response);

  if (response.status === 400) return { status: "invalid_input", messageKey, requestId };
  if (response.status === 401) return { status: "unauthenticated", requestId };
  if (response.status === 403) return { status: "forbidden", messageKey, requestId };
  if (response.status === 404) return { status: "not_found", messageKey, requestId };
  if (response.status === 409) return { status: "invalid_input", messageKey, requestId };
  if (response.status === 429) return { status: "rate_limited", requestId };
  return { status: "upstream_unavailable" };
}
