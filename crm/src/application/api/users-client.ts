/**
 * The one client for `GET /api/crm/v1/users`.
 *
 * Relative path only. The browser never learns the backend origin — the Next
 * rewrite maps this exact path server-side, which is what keeps the session
 * cookie host-only and removes any need for CORS.
 *
 * Every failure maps to a closed outcome. There is no fallback data and no mock
 * fallback: if we cannot validate the response, the list must not render.
 */
import {
  crmApiErrorSchema,
  crmApiUsersResponseSchema,
  type CrmApiUsersResponse,
} from "@/data/contracts/api/users";
import { OWNER_FILTER_PARAM, type CrmUsersOwnerFilter } from "./users-owner-filter";

export const USERS_ENDPOINT = "/api/crm/v1/users";
export const USERS_TIMEOUT_MS = 8_000;

export const USERS_DEFAULT_LIMIT = 25;
export const USERS_MIN_LIMIT = 1;
export const USERS_MAX_LIMIT = 100;
export const USERS_MAX_SEARCH_LENGTH = 100;

export type UsersOutcome =
  | { status: "success"; page: CrmApiUsersResponse }
  | { status: "invalid_input"; requestId?: string }
  | { status: "unauthenticated"; requestId?: string }
  | { status: "forbidden"; requestId?: string }
  | { status: "upstream_unavailable" }
  | { status: "malformed_response" };

export interface FetchUsersInput {
  /** Bounded to 1–100 before serialization. */
  limit?: number;
  /** Opaque backend cursor. Never decoded, never logged, never displayed. */
  cursor?: string | null;
  /** Trimmed; omitted entirely when empty. */
  search?: string;
  /**
   * Owner filter. `all` (or omitted) sends NO `owner` parameter — matching the
   * backend default, which is why the frontend never writes `owner=all`. `mine`
   * and `unassigned` are the only values ever put on the wire; `mine` carries no
   * employee id (the backend resolves the actor from the session).
   */
  owner?: CrmUsersOwnerFilter;
}

export interface FetchUsersOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injection seam for tests; production always uses global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Serialize only the keys the backend accepts, in a deterministic order:
 * `limit`, `cursor`, `search`, then `owner`. Anything else — offset, page,
 * sort, segment, status, employeeId, role, permissions — is structurally
 * impossible to send, because nothing else is ever written here.
 *
 * The `owner` parameter is written ONLY for `mine`/`unassigned`. `all` (or an
 * omitted/unexpected value) writes nothing, so the canonical request carries no
 * `owner` key and the frontend can never emit an invalid owner value.
 */
export function buildUsersQuery(input: FetchUsersInput): string {
  const params = new URLSearchParams();

  const limit = Math.min(
    USERS_MAX_LIMIT,
    Math.max(USERS_MIN_LIMIT, Math.trunc(input.limit ?? USERS_DEFAULT_LIMIT)),
  );
  params.set("limit", String(limit));

  if (input.cursor) params.set("cursor", input.cursor);

  const search = input.search?.trim() ?? "";
  if (search.length > 0) params.set("search", search.slice(0, USERS_MAX_SEARCH_LENGTH));

  // Only the two non-default values reach the wire; `all`/undefined is omitted.
  if (input.owner === "mine" || input.owner === "unassigned") {
    params.set(OWNER_FILTER_PARAM, input.owner);
  }

  return params.toString();
}

/** Pull only a support reference from an error body; never the messageKey. */
async function safeRequestId(response: Response): Promise<string | undefined> {
  const header = response.headers.get("x-request-id");
  if (header) return header;
  try {
    const parsed = crmApiErrorSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.requestId : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchUsers(
  input: FetchUsersInput = {},
  options: FetchUsersOptions = {},
): Promise<UsersOutcome> {
  const { signal, timeoutMs = USERS_TIMEOUT_MS, fetchImpl = fetch } = options;

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

  // A caller abort (query changed, component unmounted) and the timeout both
  // cancel the request; both read as upstream_unavailable, and the caller
  // discards a superseded result before it can reach state.
  const onExternalAbort = () => timeoutController.abort();
  signal?.addEventListener("abort", onExternalAbort);

  try {
    const response = await fetchImpl(`${USERS_ENDPOINT}?${buildUsersQuery(input)}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: timeoutController.signal,
    });

    if (response.status === 400) {
      return { status: "invalid_input", requestId: await safeRequestId(response) };
    }
    if (response.status === 401) {
      return { status: "unauthenticated", requestId: await safeRequestId(response) };
    }
    if (response.status === 403) {
      return { status: "forbidden", requestId: await safeRequestId(response) };
    }
    if (response.status >= 500) return { status: "upstream_unavailable" };
    if (!response.ok) return { status: "malformed_response" };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "malformed_response" };
    }

    const parsed = crmApiUsersResponseSchema.safeParse(body);
    // Deliberately no logging of `body` or `parsed.error`: either can contain
    // learner identity, and a malformed payload is exactly when it is least
    // safe to assume otherwise.
    if (!parsed.success) return { status: "malformed_response" };

    return { status: "success", page: parsed.data };
  } catch {
    // Network failure, abort and timeout all land here. No raw exception text
    // escapes this function.
    return { status: "upstream_unavailable" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}
