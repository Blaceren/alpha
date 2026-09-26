/**
 * The one client for `GET /api/crm/v1/session`.
 *
 * It calls a RELATIVE path. The browser never learns the backend origin — the
 * Next rewrite maps this exact path server-side, which is what keeps the session
 * cookie host-only and removes any need for CORS or a cookie Domain rewrite.
 *
 * Every failure maps to a closed outcome. There is no fallback session, no
 * fallback crm_admin and no fallback mock actor: if we cannot prove who the
 * employee is, the shell must not render CRM data.
 */
import {
  SessionDtoSchema,
  SessionErrorEnvelopeSchema,
  type SessionDto,
} from "@/domain/identity/session-dto";

export const SESSION_ENDPOINT = "/api/crm/v1/session";
export const SESSION_TIMEOUT_MS = 8_000;

export type SessionOutcome =
  | { status: "authenticated"; dto: SessionDto }
  | { status: "unauthenticated"; requestId?: string }
  | { status: "forbidden"; requestId?: string }
  | { status: "upstream_unavailable" }
  | { status: "malformed_response" };

/**
 * Pull only a support reference out of a 401/403 body. The status code stays
 * authoritative, and `messageKey` is intentionally discarded rather than shown:
 * backend copy is not user-facing CRM copy.
 */
async function safeRequestId(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    const parsed = SessionErrorEnvelopeSchema.safeParse(body);
    return parsed.success ? parsed.data.requestId : undefined;
  } catch {
    // A missing or non-JSON error body is fine — the status already told us
    // everything we are allowed to act on.
    return undefined;
  }
}

export interface FetchSessionOptions {
  /** Caller-supplied signal (component unmount). Composed with the timeout. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injection seam for tests; production always uses global fetch. */
  fetchImpl?: typeof fetch;
}

export async function fetchSession(options: FetchSessionOptions = {}): Promise<SessionOutcome> {
  const { signal, timeoutMs = SESSION_TIMEOUT_MS, fetchImpl = fetch } = options;

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

  // A caller abort and the timeout both need to cancel the request. Both are
  // reported as upstream_unavailable — the UI offers a retry either way.
  const onExternalAbort = () => timeoutController.abort();
  signal?.addEventListener("abort", onExternalAbort);

  try {
    const response = await fetchImpl(SESSION_ENDPOINT, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: timeoutController.signal,
    });

    if (response.status === 401) {
      return { status: "unauthenticated", requestId: await safeRequestId(response) };
    }
    if (response.status === 403) {
      return { status: "forbidden", requestId: await safeRequestId(response) };
    }
    if (response.status >= 500) return { status: "upstream_unavailable" };
    if (!response.ok) {
      // Any other non-2xx is not a contract we recognize: fail closed.
      return { status: "malformed_response" };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // 200 with a non-JSON body is a broken contract, not an outage.
      return { status: "malformed_response" };
    }

    const parsed = SessionDtoSchema.safeParse(body);
    // Deliberately no logging of `body` or `parsed.error`: either can contain
    // employee data, and a malformed payload is exactly when it is least safe
    // to assume otherwise.
    if (!parsed.success) return { status: "malformed_response" };

    return { status: "authenticated", dto: parsed.data };
  } catch {
    // Network failure, DNS failure, abort and timeout all land here. No raw
    // exception text escapes this function.
    return { status: "upstream_unavailable" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}
