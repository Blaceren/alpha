/**
 * The one client for `GET /api/crm/v1/users/{userId}`.
 *
 * Relative path only. The browser never learns the backend origin — the Next
 * rewrite maps this exact single-segment path server-side, which keeps the
 * session cookie host-only and removes any need for CORS.
 *
 * Every failure maps to a closed outcome. There is no fallback data and no mock
 * fallback: if we cannot validate the response, nothing renders.
 */
import {
  crmApiUserDetailErrorSchema,
  crmApiUserDetailSchema,
  type CrmApiUserDetail,
} from "@/data/contracts/api/user-detail";
import { isValidCrmUserId } from "@/data/contracts/api/user-id";

export const USER_DETAIL_ENDPOINT = "/api/crm/v1/users";
export const USER_DETAIL_TIMEOUT_MS = 8_000;

export type UserDetailOutcome =
  | { status: "success"; detail: CrmApiUserDetail }
  | { status: "invalid_input"; requestId?: string }
  | { status: "unauthenticated"; requestId?: string }
  | { status: "forbidden"; requestId?: string }
  | { status: "not_found"; requestId?: string }
  | { status: "upstream_unavailable" }
  | { status: "malformed_response" };

export interface FetchUserDetailOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injection seam for tests; production always uses global fetch. */
  fetchImpl?: typeof fetch;
}

/** Pull only a support reference from an error body; never the messageKey. */
async function safeRequestId(response: Response): Promise<string | undefined> {
  const header = response.headers.get("x-request-id");
  if (header) return header;
  try {
    const parsed = crmApiUserDetailErrorSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.requestId : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchUserDetail(
  userId: string,
  options: FetchUserDetailOptions = {},
): Promise<UserDetailOutcome> {
  // Validate before building a URL. A malformed id is a local answer — it never
  // costs a request, and it can never be smuggled into the path.
  if (!isValidCrmUserId(userId)) return { status: "invalid_input" };

  const { signal, timeoutMs = USER_DETAIL_TIMEOUT_MS, fetchImpl = fetch } = options;

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

  const onExternalAbort = () => timeoutController.abort();
  signal?.addEventListener("abort", onExternalAbort);

  try {
    // No query string at all — the backend rejects any query key.
    const response = await fetchImpl(
      `${USER_DETAIL_ENDPOINT}/${encodeURIComponent(userId)}`,
      {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        signal: timeoutController.signal,
      },
    );

    if (response.status === 400) {
      return { status: "invalid_input", requestId: await safeRequestId(response) };
    }
    if (response.status === 401) {
      return { status: "unauthenticated", requestId: await safeRequestId(response) };
    }
    if (response.status === 403) {
      return { status: "forbidden", requestId: await safeRequestId(response) };
    }
    if (response.status === 404) {
      return { status: "not_found", requestId: await safeRequestId(response) };
    }
    if (response.status >= 500) return { status: "upstream_unavailable" };
    if (!response.ok) return { status: "malformed_response" };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "malformed_response" };
    }

    const parsed = crmApiUserDetailSchema.safeParse(body);
    // Deliberately no logging of `body` or `parsed.error`: either can contain
    // learner identity, and a malformed payload is exactly when it is least
    // safe to assume otherwise.
    if (!parsed.success) return { status: "malformed_response" };

    return { status: "success", detail: parsed.data };
  } catch {
    // Network failure, abort and timeout all land here. No raw exception text
    // escapes this function.
    return { status: "upstream_unavailable" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}
