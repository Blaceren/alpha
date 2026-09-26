/**
 * The one client for CRM Learner Owner History (OH-1):
 *
 *   GET /api/crm/v1/users/{userId}/owner/history
 *
 * Relative path only. The browser never learns the backend origin — the Next
 * rewrite maps this exact nested path server-side, which keeps the session
 * cookie host-only and removes any need for CORS.
 *
 * Every failure maps to a closed outcome. There is no fallback data and no mock
 * fallback: if we cannot validate the response, nothing renders. History is
 * read-only — there is no create, update or delete client, by design.
 */
import {
  crmApiOwnerHistoryErrorSchema,
  crmApiOwnerHistoryPageSchema,
  type CrmApiOwnerHistoryPage,
} from "@/data/contracts/api/user-owner-history";
import { isValidCrmUserId } from "@/data/contracts/api/user-id";

export const OWNER_HISTORY_USERS_ENDPOINT = "/api/crm/v1/users";
export const OWNER_HISTORY_TIMEOUT_MS = 8_000;

/** Backend bounds. A caller may not exceed them; the backend re-checks anyway. */
export const OWNER_HISTORY_MIN_LIMIT = 1;
export const OWNER_HISTORY_MAX_LIMIT = 50;

export type OwnerHistoryListOutcome =
  | { status: "success"; page: CrmApiOwnerHistoryPage }
  | { status: "invalid_input"; requestId?: string }
  | { status: "unauthenticated"; requestId?: string }
  | { status: "forbidden"; requestId?: string }
  | { status: "not_found"; requestId?: string }
  | { status: "upstream_unavailable" }
  | { status: "malformed_response" };

export interface FetchOwnerHistoryOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injection seam for tests; production always uses global fetch. */
  fetchImpl?: typeof fetch;
}

export interface FetchOwnerHistoryInput {
  limit?: number;
  cursor?: string;
}

/** Pull only a support reference from an error body; never the messageKey. */
async function safeRequestId(response: Response): Promise<string | undefined> {
  const header = response.headers.get("x-request-id");
  if (header) return header;
  try {
    const parsed = crmApiOwnerHistoryErrorSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.requestId : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Shared status mapping. The HTTP status is authoritative: the backend answers
 * 403 with the code `unauthorized`, so trusting the body code would collapse
 * "not a CRM employee" and "lacks view_audit" into one state.
 */
async function mapErrorStatus(response: Response): Promise<OwnerHistoryListOutcome | null> {
  if (response.status === 400) return { status: "invalid_input", requestId: await safeRequestId(response) };
  if (response.status === 401) return { status: "unauthenticated", requestId: await safeRequestId(response) };
  if (response.status === 403) return { status: "forbidden", requestId: await safeRequestId(response) };
  if (response.status === 404) return { status: "not_found", requestId: await safeRequestId(response) };
  if (response.status >= 500) return { status: "upstream_unavailable" };
  return null;
}

function withTimeout(options: FetchOwnerHistoryOptions) {
  const { signal, timeoutMs = OWNER_HISTORY_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort);
  return {
    signal: controller.signal,
    release() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onExternalAbort);
    },
  };
}

export async function fetchUserOwnerHistory(
  userId: string,
  input: FetchOwnerHistoryInput = {},
  options: FetchOwnerHistoryOptions = {},
): Promise<OwnerHistoryListOutcome> {
  // Validate before building a URL. A malformed id is a local answer — it never
  // costs a request, and it can never be smuggled into the path.
  if (!isValidCrmUserId(userId)) return { status: "invalid_input" };

  // Only the two supported keys are ever sent. An out-of-range limit is a local
  // rejection rather than a request the backend will refuse.
  const params = new URLSearchParams();
  if (input.limit !== undefined) {
    if (
      !Number.isInteger(input.limit) ||
      input.limit < OWNER_HISTORY_MIN_LIMIT ||
      input.limit > OWNER_HISTORY_MAX_LIMIT
    ) {
      return { status: "invalid_input" };
    }
    params.set("limit", String(input.limit));
  }
  if (input.cursor !== undefined) {
    if (input.cursor === "") return { status: "invalid_input" };
    params.set("cursor", input.cursor);
  }

  const query = params.toString();
  const url =
    `${OWNER_HISTORY_USERS_ENDPOINT}/${encodeURIComponent(userId)}/owner/history` +
    (query ? `?${query}` : "");

  const { fetchImpl = fetch } = options;
  const timeout = withTimeout(options);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: timeout.signal,
    });

    const mapped = await mapErrorStatus(response);
    if (mapped) return mapped;
    if (!response.ok) return { status: "malformed_response" };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "malformed_response" };
    }

    const parsed = crmApiOwnerHistoryPageSchema.safeParse(body);
    if (!parsed.success) return { status: "malformed_response" };
    return { status: "success", page: parsed.data };
  } catch {
    // Network failure, abort and timeout all land here. No raw exception text
    // escapes this function.
    return { status: "upstream_unavailable" };
  } finally {
    timeout.release();
  }
}
