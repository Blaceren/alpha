/**
 * G3 — the browser client for the Backend mentor-review reviewer API.
 *
 * Relative paths only, forwarded by the CRM's same-origin rewrite allowlist. The
 * browser never learns `CRM_BACKEND_ORIGIN` — the property CRM-AUTH-1
 * established and this phase must not weaken.
 *
 * TWO CALLS, AND ONLY TWO. `fetchMentorQueue` (read) and `approveMentorReview`
 * (the one command). There is no claim, no release, no reassign and no reject,
 * because the canonical lifecycle has no such transition. A client function for
 * one would be a promise the Backend cannot keep.
 *
 * THE APPROVE REQUEST HAS NO BODY. Not a rubric, not a score, not a comment, not
 * a reviewer id — the Backend takes the reviewer from the session and everything
 * else from the named progress row. The only thing that travels is the
 * double-submit CSRF header.
 *
 * IDEMPOTENCY IS THE BACKEND'S, DERIVED FROM STATE. Unlike the report workflow
 * there is no caller-supplied `Idempotency-Key`: the mentor completion source id
 * is `mentor-review:<progressId>`, derived from durable state, so a repeat
 * approval by the same reviewer replays by construction and needs no header.
 *
 * Every failure maps to a closed outcome. `forbidden` is a first-class result,
 * not an error: it is how a valid staff member who is not a reviewer is told so.
 */
import {
  MENTOR_CONFLICT_CODES,
  MENTOR_QUEUE_DEFAULT_LIMIT,
  MENTOR_QUEUE_ENDPOINT,
  MENTOR_QUEUE_MAX_LIMIT,
  MENTOR_QUEUE_MIN_LIMIT,
  MentorApprovalResultSchema,
  MentorErrorSchema,
  MentorQueuePageSchema,
  mentorApproveEndpoint,
  type MentorApprovalResult,
  type MentorQueuePage,
} from "@/data/contracts/api/mentor-review";
import { csrfHeaders } from "@/application/api/auth-client";

export const MENTOR_TIMEOUT_MS = 12_000;

export type MentorFailure =
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "flag_disabled" }
  | { status: "conflict"; code: string }
  | { status: "not_found" }
  | { status: "invalid_input" }
  | { status: "rate_limited" }
  | { status: "upstream_unavailable" }
  | { status: "malformed_response" };

export type MentorQueueOutcome = { status: "success"; page: MentorQueuePage } | MentorFailure;
export type MentorApprovalOutcome =
  | { status: "success"; result: MentorApprovalResult }
  | MentorFailure;

export interface MentorRequestOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function withTimeout(options: MentorRequestOptions) {
  const { signal, timeoutMs = MENTOR_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  return {
    signal: controller.signal,
    release() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

/** Read the Backend's stable error discriminator; never its prose. */
async function errorCodeOf(response: Response): Promise<string | null> {
  try {
    const parsed = MentorErrorSchema.safeParse(await response.clone().json());
    return parsed.success ? parsed.data.error : null;
  } catch {
    return null;
  }
}

async function mapFailure(response: Response): Promise<MentorFailure> {
  const code = await errorCodeOf(response);

  if (response.status === 401) return { status: "unauthenticated" };
  if (response.status === 403) {
    // The flag envelope and the reviewer gate both arrive as 403 and mean
    // completely different things to an operator: "this feature is off" versus
    // "your account may not review". Collapsing them produces a support ticket.
    if (code === "MENTOR_REVIEW_DISABLED" || code === "CURRICULUM_DISABLED") {
      return { status: "flag_disabled" };
    }
    return { status: "forbidden" };
  }
  if (response.status === 404) return { status: "not_found" };
  if (response.status === 409 || (code && (MENTOR_CONFLICT_CODES as readonly string[]).includes(code))) {
    return { status: "conflict", code: code ?? "MENTOR_REVIEW_CONFLICT" };
  }
  if (response.status === 400) {
    return code && (MENTOR_CONFLICT_CODES as readonly string[]).includes(code)
      ? { status: "conflict", code }
      : { status: "invalid_input" };
  }
  if (response.status === 429) return { status: "rate_limited" };
  if (response.status >= 500) return { status: "upstream_unavailable" };
  return { status: "malformed_response" };
}

/** Unwrap the Backend's `{ data: … }` envelope. */
async function unwrap(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (typeof body === "object" && body !== null && "data" in body) {
    return (body as { data: unknown }).data;
  }
  return body;
}

/* ------------------------------------------------------------------- queue */

export interface FetchMentorQueueInput {
  limit?: number;
  cursor?: number;
}

/**
 * Read the mentor-review queue.
 *
 * This read is also the reviewer-capability probe, for the same reason the
 * report queue is: the CRM staff session DTO carries `StaffProfile.staffRole`,
 * while the Backend reviewer gate checks `User.role ∈ {mentor, admin}` — a
 * different axis the staff DTO does not expose. CRM must not guess which from
 * the other. One request answers both "may you review?" and "what is pending?".
 */
export async function fetchMentorQueue(
  input: FetchMentorQueueInput = {},
  options: MentorRequestOptions = {},
): Promise<MentorQueueOutcome> {
  const params = new URLSearchParams();
  if (input.limit !== undefined) {
    if (
      !Number.isInteger(input.limit) ||
      input.limit < MENTOR_QUEUE_MIN_LIMIT ||
      input.limit > MENTOR_QUEUE_MAX_LIMIT
    ) {
      return { status: "invalid_input" };
    }
    params.set("limit", String(input.limit));
  } else {
    params.set("limit", String(MENTOR_QUEUE_DEFAULT_LIMIT));
  }
  if (input.cursor !== undefined) {
    if (!Number.isInteger(input.cursor) || input.cursor <= 0) return { status: "invalid_input" };
    params.set("cursor", String(input.cursor));
  }

  const { fetchImpl = fetch } = options;
  const timeout = withTimeout(options);
  try {
    const response = await fetchImpl(`${MENTOR_QUEUE_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: timeout.signal,
    });
    if (!response.ok) return mapFailure(response);

    const parsed = MentorQueuePageSchema.safeParse(await unwrap(response));
    // Deliberately no logging of the payload or the parse error: both name learners.
    if (!parsed.success) return { status: "malformed_response" };
    return { status: "success", page: parsed.data };
  } catch {
    return { status: "upstream_unavailable" };
  } finally {
    timeout.release();
  }
}

/* ----------------------------------------------------------------- approve */

/**
 * Approve one waiting mentor review.
 *
 * A MISSING CSRF TOKEN IS A HARD LOCAL FAILURE. Sending a state-changing request
 * without one would be refused by the Backend anyway; failing here means the
 * reviewer is told the truth rather than seeing an opaque 403.
 */
export async function approveMentorReview(
  progressId: number,
  options: MentorRequestOptions = {},
): Promise<MentorApprovalOutcome> {
  if (!Number.isInteger(progressId) || progressId <= 0) return { status: "invalid_input" };

  const { fetchImpl = fetch } = options;
  const headers = await csrfHeaders({ fetchImpl });
  if (Object.keys(headers).length === 0) return { status: "upstream_unavailable" };

  const timeout = withTimeout(options);
  try {
    const response = await fetchImpl(mentorApproveEndpoint(progressId), {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      // No body at all. The Backend route takes none.
      headers,
      signal: timeout.signal,
    });
    if (!response.ok) return mapFailure(response);

    const parsed = MentorApprovalResultSchema.safeParse(await unwrap(response));
    if (!parsed.success) return { status: "malformed_response" };
    return { status: "success", result: parsed.data };
  } catch {
    return { status: "upstream_unavailable" };
  } finally {
    timeout.release();
  }
}
