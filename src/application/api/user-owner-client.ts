/**
 * The three clients for CRM Learner Owner v1:
 *
 *   GET /api/crm/v1/users/{userId}/owner
 *   GET /api/crm/v1/owner-candidates
 *   PUT /api/crm/v1/users/{userId}/owner
 *
 * Relative paths only. The browser never learns the backend origin — the Next
 * rewrite maps these exact paths server-side, which keeps the session cookie
 * host-only and removes any need for CORS.
 *
 * Every failure maps to a closed outcome. There is no fallback data and no mock
 * fallback: if we cannot validate a response, nothing renders and nothing is
 * reported as changed. The 409 conflict is a first-class outcome, distinct from
 * every other error, because the UI must react to it specifically (refetch).
 */
import {
  crmApiOwnerCandidatesPageSchema,
  crmApiOwnerErrorSchema,
  crmApiOwnerResponseSchema,
  isValidExpectedVersion,
  validateOwnerEmployeeId,
  type CrmApiOwnerCandidatesPage,
  type CrmApiOwnerResponse,
} from "@/data/contracts/api/user-owner";
import { isValidCrmUserId } from "@/data/contracts/api/user-id";

export const OWNER_USERS_ENDPOINT = "/api/crm/v1/users";
export const OWNER_CANDIDATES_ENDPOINT = "/api/crm/v1/owner-candidates";
export const OWNER_TIMEOUT_MS = 8_000;

/** Backend bounds. A caller may not exceed them; the backend re-checks anyway. */
export const CANDIDATES_MIN_LIMIT = 1;
export const CANDIDATES_MAX_LIMIT = 100;

export type OwnerReadOutcome =
  | { status: "success"; owner: CrmApiOwnerResponse }
  | { status: "invalid_input"; requestId?: string }
  | { status: "unauthenticated"; requestId?: string }
  | { status: "forbidden"; requestId?: string }
  | { status: "not_found"; requestId?: string }
  | { status: "upstream_unavailable" }
  | { status: "malformed_response" };

export type OwnerCandidatesOutcome =
  | { status: "success"; page: CrmApiOwnerCandidatesPage }
  | { status: "invalid_input"; requestId?: string }
  | { status: "unauthenticated"; requestId?: string }
  | { status: "forbidden"; requestId?: string }
  | { status: "not_found"; requestId?: string }
  | { status: "upstream_unavailable" }
  | { status: "malformed_response" };

export type OwnerMutationOutcome =
  | { status: "success"; owner: CrmApiOwnerResponse }
  | { status: "invalid_input"; requestId?: string }
  | { status: "unauthenticated"; requestId?: string }
  | { status: "forbidden"; requestId?: string }
  // A 404 whose stable messageKey names the LEARNER — the whole detail is gone.
  | { status: "not_found"; requestId?: string }
  // A 404 whose stable messageKey names the CANDIDATE — the learner is fine, the
  // chosen employee is unavailable. Distinguished by messageKey, never rendered.
  | { status: "candidate_not_found"; requestId?: string }
  | { status: "conflict"; requestId?: string }
  | { status: "upstream_unavailable" }
  | { status: "malformed_response" };

/** The backend's stable messageKey for a candidate (not learner) 404. */
export const CANDIDATE_NOT_FOUND_MESSAGE_KEY = "crm.users.owner.candidate_not_found";

export interface OwnerRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injection seam for tests; production always uses global fetch. */
  fetchImpl?: typeof fetch;
}

export interface FetchOwnerCandidatesInput {
  limit?: number;
  cursor?: string;
}

/** Pull only a support reference from an error body; never the messageKey. */
async function safeRequestId(response: Response): Promise<string | undefined> {
  const header = response.headers.get("x-request-id");
  if (header) return header;
  try {
    const parsed = crmApiOwnerErrorSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.requestId : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Shared status mapping. The HTTP status is authoritative: the backend answers
 * 403 with the code `unauthorized`, so trusting the body code would collapse
 * "not a CRM employee" and "lacks assign_owner" into one state. 409 is handled
 * by the mutation caller directly, since only mutations can conflict.
 */
async function mapCommonError(
  response: Response,
): Promise<
  | { status: "invalid_input"; requestId?: string }
  | { status: "unauthenticated"; requestId?: string }
  | { status: "forbidden"; requestId?: string }
  | { status: "not_found"; requestId?: string }
  | { status: "upstream_unavailable" }
  | null
> {
  if (response.status === 400) return { status: "invalid_input", requestId: await safeRequestId(response) };
  if (response.status === 401) return { status: "unauthenticated", requestId: await safeRequestId(response) };
  if (response.status === 403) return { status: "forbidden", requestId: await safeRequestId(response) };
  if (response.status === 404) return { status: "not_found", requestId: await safeRequestId(response) };
  if (response.status >= 500) return { status: "upstream_unavailable" };
  return null;
}

function withTimeout(options: OwnerRequestOptions) {
  const { signal, timeoutMs = OWNER_TIMEOUT_MS } = options;
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

/* --------------------------------------------------------- current owner */

export async function fetchUserOwner(
  userId: string,
  options: OwnerRequestOptions = {},
): Promise<OwnerReadOutcome> {
  // Validate before building a URL. A malformed id is a local answer — it never
  // costs a request, and it can never be smuggled into the path.
  if (!isValidCrmUserId(userId)) return { status: "invalid_input" };

  const url = `${OWNER_USERS_ENDPOINT}/${encodeURIComponent(userId)}/owner`;
  const { fetchImpl = fetch } = options;
  const timeout = withTimeout(options);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: timeout.signal,
    });

    const mapped = await mapCommonError(response);
    if (mapped) return mapped;
    if (!response.ok) return { status: "malformed_response" };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "malformed_response" };
    }

    const parsed = crmApiOwnerResponseSchema.safeParse(body);
    if (!parsed.success) return { status: "malformed_response" };
    return { status: "success", owner: parsed.data };
  } catch {
    return { status: "upstream_unavailable" };
  } finally {
    timeout.release();
  }
}

/* ------------------------------------------------------- owner candidates */

export async function fetchOwnerCandidates(
  input: FetchOwnerCandidatesInput = {},
  options: OwnerRequestOptions = {},
): Promise<OwnerCandidatesOutcome> {
  // Only the two supported keys are ever sent. No search key exists. An
  // out-of-range limit is a local rejection rather than a request to be refused.
  const params = new URLSearchParams();
  if (input.limit !== undefined) {
    if (!Number.isInteger(input.limit) || input.limit < CANDIDATES_MIN_LIMIT || input.limit > CANDIDATES_MAX_LIMIT) {
      return { status: "invalid_input" };
    }
    params.set("limit", String(input.limit));
  }
  if (input.cursor !== undefined) {
    if (input.cursor === "") return { status: "invalid_input" };
    params.set("cursor", input.cursor);
  }

  const query = params.toString();
  const url = OWNER_CANDIDATES_ENDPOINT + (query ? `?${query}` : "");
  const { fetchImpl = fetch } = options;
  const timeout = withTimeout(options);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: timeout.signal,
    });

    const mapped = await mapCommonError(response);
    if (mapped) return mapped;
    if (!response.ok) return { status: "malformed_response" };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "malformed_response" };
    }

    const parsed = crmApiOwnerCandidatesPageSchema.safeParse(body);
    if (!parsed.success) return { status: "malformed_response" };
    return { status: "success", page: parsed.data };
  } catch {
    return { status: "upstream_unavailable" };
  } finally {
    timeout.release();
  }
}

/* -------------------------------------------------------------- mutation */

export async function setUserOwner(
  userId: string,
  ownerEmployeeId: string | null,
  expectedVersion: number,
  options: OwnerRequestOptions = {},
): Promise<OwnerMutationOutcome> {
  // Validate everything locally first: an invalid userId, employeeId or version
  // never costs a request, and the value that travels is exactly what validated.
  if (!isValidCrmUserId(userId)) return { status: "invalid_input" };
  const owner = validateOwnerEmployeeId(ownerEmployeeId);
  if (!owner.ok) return { status: "invalid_input" };
  if (!isValidExpectedVersion(expectedVersion)) return { status: "invalid_input" };

  const url = `${OWNER_USERS_ENDPOINT}/${encodeURIComponent(userId)}/owner`;
  const { fetchImpl = fetch } = options;
  const timeout = withTimeout(options);

  try {
    // No query string at all. The body carries EXACTLY two fields — no actor, no
    // learner id, no role, no reason. The employee id stays an opaque string.
    const response = await fetchImpl(url, {
      method: "PUT",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerEmployeeId: owner.value, expectedVersion }),
      signal: timeout.signal,
    });

    // 409 is a first-class outcome and must be distinguished before the shared
    // mapping, which does not know about conflicts.
    if (response.status === 409) return { status: "conflict", requestId: await safeRequestId(response) };

    // A 404 needs its stable messageKey to tell a missing LEARNER (the whole
    // detail is gone) from an unavailable CANDIDATE (the learner is fine). The
    // HTTP status alone cannot distinguish these; the messageKey is read for a
    // behaviour branch only and is never rendered.
    if (response.status === 404) {
      let messageKey: string | undefined;
      let requestId = response.headers.get("x-request-id") ?? undefined;
      try {
        const parsed = crmApiOwnerErrorSchema.safeParse(await response.json());
        if (parsed.success) {
          messageKey = parsed.data.messageKey;
          requestId = requestId ?? parsed.data.requestId;
        }
      } catch {
        /* fall through to the learner-level default */
      }
      return messageKey === CANDIDATE_NOT_FOUND_MESSAGE_KEY
        ? { status: "candidate_not_found", requestId }
        : { status: "not_found", requestId };
    }

    const mapped = await mapCommonError(response);
    if (mapped) return mapped;

    // 200 is the only success. Anything else with an ok status is a contract
    // violation and must not be reported as an applied change.
    if (response.status !== 200) return { status: "malformed_response" };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "malformed_response" };
    }

    const parsed = crmApiOwnerResponseSchema.safeParse(body);
    if (!parsed.success) return { status: "malformed_response" };
    return { status: "success", owner: parsed.data };
  } catch {
    return { status: "upstream_unavailable" };
  } finally {
    timeout.release();
  }
}
