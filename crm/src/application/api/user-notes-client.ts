/**
 * The two clients for CRM User Notes v1:
 *
 *   GET  /api/crm/v1/users/{userId}/notes
 *   POST /api/crm/v1/users/{userId}/notes
 *
 * Relative paths only. The browser never learns the backend origin — the Next
 * rewrite maps this exact nested path server-side, which keeps the session
 * cookie host-only and removes any need for CORS.
 *
 * Every failure maps to a closed outcome. There is no fallback data and no mock
 * fallback: if we cannot validate the response, nothing renders and nothing is
 * reported as created.
 */
import {
  crmApiUserNoteCreatedSchema,
  crmApiUserNotesErrorSchema,
  crmApiUserNotesPageSchema,
  validateNoteBody,
  type CrmApiUserNote,
  type CrmApiUserNotesPage,
} from "@/data/contracts/api/user-notes";
import { isValidCrmUserId } from "@/data/contracts/api/user-id";

export const USER_NOTES_ENDPOINT = "/api/crm/v1/users";
export const USER_NOTES_TIMEOUT_MS = 8_000;

/** Backend bounds. A caller may not exceed them; the backend re-checks anyway. */
export const NOTES_MIN_LIMIT = 1;
export const NOTES_MAX_LIMIT = 100;

export type NotesListOutcome =
  | { status: "success"; page: CrmApiUserNotesPage }
  | { status: "invalid_input"; requestId?: string }
  | { status: "unauthenticated"; requestId?: string }
  | { status: "forbidden"; requestId?: string }
  | { status: "not_found"; requestId?: string }
  | { status: "upstream_unavailable" }
  | { status: "malformed_response" };

export type NoteCreateOutcome =
  | { status: "success"; note: CrmApiUserNote }
  | { status: "invalid_input"; requestId?: string }
  | { status: "unauthenticated"; requestId?: string }
  | { status: "forbidden"; requestId?: string }
  | { status: "not_found"; requestId?: string }
  | { status: "upstream_unavailable" }
  | { status: "malformed_response" };

export interface FetchUserNotesOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injection seam for tests; production always uses global fetch. */
  fetchImpl?: typeof fetch;
}

export interface FetchUserNotesInput {
  limit?: number;
  cursor?: string;
}

/** Pull only a support reference from an error body; never the messageKey. */
async function safeRequestId(response: Response): Promise<string | undefined> {
  const header = response.headers.get("x-request-id");
  if (header) return header;
  try {
    const parsed = crmApiUserNotesErrorSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.requestId : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Shared status mapping. The HTTP status is authoritative: the backend answers
 * 403 with the code `unauthorized`, so trusting the body code would collapse
 * "not a CRM employee" and "lacks the notes permission" into one state.
 */
async function mapErrorStatus(
  response: Response,
): Promise<NotesListOutcome | NoteCreateOutcome | null> {
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
  return null;
}

function withTimeout(options: FetchUserNotesOptions) {
  const { signal, timeoutMs = USER_NOTES_TIMEOUT_MS } = options;
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

/* -------------------------------------------------------------------- list */

export async function fetchUserNotes(
  userId: string,
  input: FetchUserNotesInput = {},
  options: FetchUserNotesOptions = {},
): Promise<NotesListOutcome> {
  // Validate before building a URL. A malformed id is a local answer — it never
  // costs a request, and it can never be smuggled into the path.
  if (!isValidCrmUserId(userId)) return { status: "invalid_input" };

  // Only the two supported keys are ever sent. An out-of-range limit is a local
  // rejection rather than a request the backend will refuse.
  const params = new URLSearchParams();
  if (input.limit !== undefined) {
    if (
      !Number.isInteger(input.limit) ||
      input.limit < NOTES_MIN_LIMIT ||
      input.limit > NOTES_MAX_LIMIT
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
    `${USER_NOTES_ENDPOINT}/${encodeURIComponent(userId)}/notes` + (query ? `?${query}` : "");

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
    if (mapped) return mapped as NotesListOutcome;
    if (!response.ok) return { status: "malformed_response" };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "malformed_response" };
    }

    const parsed = crmApiUserNotesPageSchema.safeParse(body);
    // Deliberately no logging of `body` or `parsed.error`: either can contain
    // note text, and a malformed payload is exactly when it is least safe to
    // assume otherwise.
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

/* ------------------------------------------------------------------ create */

export async function createUserNote(
  userId: string,
  rawBody: string,
  options: FetchUserNotesOptions = {},
): Promise<NoteCreateOutcome> {
  if (!isValidCrmUserId(userId)) return { status: "invalid_input" };

  // Normalize and validate locally. An invalid draft never costs a request, and
  // the value that travels is exactly the value that was validated.
  const validated = validateNoteBody(rawBody);
  if (!validated.ok) return { status: "invalid_input" };

  const { fetchImpl = fetch } = options;
  const timeout = withTimeout(options);

  try {
    // No query string at all — the backend rejects any query key on POST.
    // The payload carries exactly one field: the author comes from the session
    // cookie server-side and is never supplied by the client.
    const response = await fetchImpl(
      `${USER_NOTES_ENDPOINT}/${encodeURIComponent(userId)}/notes`,
      {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: validated.body }),
        signal: timeout.signal,
      },
    );

    const mapped = await mapErrorStatus(response);
    if (mapped) return mapped as NoteCreateOutcome;

    // 201 is the only success. A 200 is NOT silently accepted as a create: the
    // contract documents 201, so anything else is a contract violation and must
    // not clear the employee's draft as though the note were stored.
    if (response.status !== 201) return { status: "malformed_response" };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "malformed_response" };
    }

    const parsed = crmApiUserNoteCreatedSchema.safeParse(body);
    if (!parsed.success) return { status: "malformed_response" };

    return { status: "success", note: parsed.data };
  } catch {
    return { status: "upstream_unavailable" };
  } finally {
    timeout.release();
  }
}
