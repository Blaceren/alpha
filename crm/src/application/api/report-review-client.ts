/**
 * The browser client for the Backend reviewer API.
 *
 * Relative paths only, forwarded by the CRM's same-origin rewrite allowlist. The
 * browser never learns `CRM_BACKEND_ORIGIN` — the property CRM-AUTH-1 established
 * and this phase must not weaken.
 *
 * Writes carry two things the reads do not: the double-submit CSRF header from
 * `csrfHeaders()` (the one bounded helper, reused rather than reinvented) and a
 * caller-supplied `Idempotency-Key`. The key is supplied by the caller, not
 * generated here, because a retry must send the *same* key — generating one per
 * call would make every retry a new command, which is precisely the duplicate
 * this contract exists to prevent.
 *
 * Every failure maps to a closed outcome. `forbidden` is a first-class result,
 * not an error: it is how a valid staff member who is not a reviewer is told so.
 */
import {
  ApprovalResultSchema,
  CommandResultSchema,
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_KEY_PATTERN,
  QueuePageSchema,
  REPORT_CONFLICT_CODES,
  REVIEW_QUEUE_ENDPOINT,
  REVIEW_SUBMISSIONS_ENDPOINT,
  ReportErrorSchema,
  ReviewDetailSchema,
  type ApprovalResult,
  type Cas,
  type CommandResult,
  type QueuePage,
  type ReviewDetail,
  type ReviewScore,
} from "@/data/contracts/api/report-review";
import { csrfHeaders } from "@/application/api/auth-client";

export const REVIEW_TIMEOUT_MS = 12_000;

/** Backend bounds on the queue page size. The backend re-checks regardless. */
export const QUEUE_MIN_LIMIT = 1;
export const QUEUE_MAX_LIMIT = 50;
export const QUEUE_DEFAULT_LIMIT = 20;

/** The only locale the fixture and the approved package publish. */
export const REVIEW_LOCALE = "ru";

/**
 * Closed outcome set shared by every reviewer call.
 *
 * `flag_disabled` and `forbidden` are distinct on purpose. Both arrive as a 403
 * family from the backend, but they mean completely different things to an
 * operator: "this feature is switched off" versus "your account may not review".
 * Collapsing them would produce a support ticket every time.
 */
export type ReviewFailure =
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "flag_disabled" }
  | { status: "conflict"; code: string }
  | { status: "invalid_input" }
  | { status: "not_found" }
  | { status: "rate_limited" }
  | { status: "upstream_unavailable" }
  | { status: "malformed_response" };

export type QueueOutcome = { status: "success"; page: QueuePage } | ReviewFailure;
export type DetailOutcome = { status: "success"; detail: ReviewDetail } | ReviewFailure;
export type CommandOutcome = { status: "success"; result: CommandResult } | ReviewFailure;
export type ApprovalOutcome = { status: "success"; result: ApprovalResult } | ReviewFailure;

export interface ReviewRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injection seam for tests; production always uses global fetch. */
  fetchImpl?: typeof fetch;
}

function withTimeout(options: ReviewRequestOptions) {
  const { signal, timeoutMs = REVIEW_TIMEOUT_MS } = options;
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

/** Read the backend's stable error discriminator; never its prose. */
async function errorCodeOf(response: Response): Promise<string | null> {
  try {
    const parsed = ReportErrorSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.error : null;
  } catch {
    return null;
  }
}

/**
 * Map a non-2xx response onto a closed failure.
 *
 * The disabled-flag envelope and a reviewer 403 both arrive as 403, so the body's
 * `error` code is what separates them. A flag-disabled backend answers exactly as
 * a missing route would, which is why an unrecognised 403 is treated as
 * `forbidden` — the safer of the two readings for an authorization boundary.
 */
async function mapFailure(response: Response): Promise<ReviewFailure> {
  const code = await errorCodeOf(response);

  if (response.status === 401) return { status: "unauthenticated" };
  if (response.status === 403) {
    if (code === "REPORT_DISABLED" || code === "REPORT_FEATURE_DISABLED") {
      return { status: "flag_disabled" };
    }
    return { status: "forbidden" };
  }
  if (response.status === 404) {
    // The backend deliberately collapses "not yours", "wrong state" and "unknown"
    // into one not-found so unauthorized existence never leaks.
    return { status: "not_found" };
  }
  if (response.status === 409 || (code && (REPORT_CONFLICT_CODES as readonly string[]).includes(code))) {
    return { status: "conflict", code: code ?? "REPORT_CONFLICT" };
  }
  if (response.status === 400) {
    return code && (REPORT_CONFLICT_CODES as readonly string[]).includes(code)
      ? { status: "conflict", code }
      : { status: "invalid_input" };
  }
  if (response.status === 429) return { status: "rate_limited" };
  if (response.status >= 500) return { status: "upstream_unavailable" };
  return { status: "malformed_response" };
}

/** Unwrap the backend's `{ data: … }` envelope. */
async function unwrap(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (typeof body === "object" && body !== null && "data" in body) {
    return (body as { data: unknown }).data;
  }
  return body;
}

/* ------------------------------------------------------------------- queue */

export interface FetchQueueInput {
  limit?: number;
  cursor?: string;
}

export async function fetchReviewQueue(
  input: FetchQueueInput = {},
  options: ReviewRequestOptions = {},
): Promise<QueueOutcome> {
  const params = new URLSearchParams({ locale: REVIEW_LOCALE });
  if (input.limit !== undefined) {
    if (!Number.isInteger(input.limit) || input.limit < QUEUE_MIN_LIMIT || input.limit > QUEUE_MAX_LIMIT) {
      return { status: "invalid_input" };
    }
    params.set("limit", String(input.limit));
  }
  if (input.cursor !== undefined) {
    if (input.cursor === "") return { status: "invalid_input" };
    params.set("cursor", input.cursor);
  }

  const { fetchImpl = fetch } = options;
  const timeout = withTimeout(options);
  try {
    const response = await fetchImpl(`${REVIEW_QUEUE_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: timeout.signal,
    });
    if (!response.ok) return mapFailure(response);

    const parsed = QueuePageSchema.safeParse(await unwrap(response));
    // Deliberately no logging of the payload or the parse error: both can carry
    // learner report prose.
    if (!parsed.success) return { status: "malformed_response" };
    return { status: "success", page: parsed.data };
  } catch {
    return { status: "upstream_unavailable" };
  } finally {
    timeout.release();
  }
}

/* ------------------------------------------------------------------ detail */

function submissionUrl(submissionRef: string, suffix = ""): string {
  return `${REVIEW_SUBMISSIONS_ENDPOINT}/${encodeURIComponent(submissionRef)}${suffix}`;
}

export async function fetchReviewDetail(
  submissionRef: string,
  options: ReviewRequestOptions = {},
): Promise<DetailOutcome> {
  if (submissionRef.trim() === "") return { status: "invalid_input" };

  const { fetchImpl = fetch } = options;
  const timeout = withTimeout(options);
  try {
    const response = await fetchImpl(`${submissionUrl(submissionRef)}?locale=${REVIEW_LOCALE}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: timeout.signal,
    });
    if (!response.ok) return mapFailure(response);

    const parsed = ReviewDetailSchema.safeParse(await unwrap(response));
    if (!parsed.success) return { status: "malformed_response" };
    return { status: "success", detail: parsed.data };
  } catch {
    return { status: "upstream_unavailable" };
  } finally {
    timeout.release();
  }
}

/* ---------------------------------------------------------------- commands */

async function postCommand(
  submissionRef: string,
  operation: string,
  idempotencyKey: string,
  body: unknown,
  options: ReviewRequestOptions,
): Promise<{ response: Response } | { failure: ReviewFailure }> {
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    // A malformed key can only ever 400 — answer locally rather than spend a
    // request and a rate-limit slot on it.
    return { failure: { status: "invalid_input" } };
  }

  const { fetchImpl = fetch } = options;
  const timeout = withTimeout(options);
  try {
    const headers = await csrfHeaders({ fetchImpl });
    const response = await fetchImpl(submissionUrl(submissionRef, `/${operation}`), {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        [IDEMPOTENCY_HEADER]: idempotencyKey,
        ...headers,
      },
      body: JSON.stringify(body),
      signal: timeout.signal,
    });
    return { response };
  } catch {
    return { failure: { status: "upstream_unavailable" } };
  } finally {
    timeout.release();
  }
}

/**
 * Claim a submission for review.
 *
 * Required before the detail payload is released: the backend reveals the report
 * only to the holder of the active claim.
 */
export async function claimSubmission(
  submissionRef: string,
  cas: Cas,
  idempotencyKey: string,
  options: ReviewRequestOptions = {},
): Promise<CommandOutcome> {
  const sent = await postCommand(submissionRef, "claim", idempotencyKey, cas, options);
  if ("failure" in sent) return sent.failure;
  if (!sent.response.ok) return mapFailure(sent.response);

  const parsed = CommandResultSchema.safeParse(await unwrap(sent.response));
  if (!parsed.success) return { status: "malformed_response" };
  return { status: "success", result: parsed.data };
}

export interface RevisionRequestInput extends Cas {
  scores: ReviewScore[];
  reasonCode: string;
  humanComment: string;
  correctiveAction: string;
}

/** REVISION_REQUESTED. Non-completing: L3 stays incomplete and L4 stays locked. */
export async function requestRevision(
  submissionRef: string,
  input: RevisionRequestInput,
  idempotencyKey: string,
  options: ReviewRequestOptions = {},
): Promise<CommandOutcome> {
  const sent = await postCommand(submissionRef, "reject", idempotencyKey, input, options);
  if ("failure" in sent) return sent.failure;
  if (!sent.response.ok) return mapFailure(sent.response);

  const parsed = CommandResultSchema.safeParse(await unwrap(sent.response));
  if (!parsed.success) return { status: "malformed_response" };
  return { status: "success", result: parsed.data };
}

export interface ApprovalInput extends Cas {
  scores: ReviewScore[];
}

/**
 * APPROVE. The backend completes L3 and unlocks L4 inside its own transaction —
 * CRM issues no separate completion write and computes no unlock.
 */
export async function approveSubmission(
  submissionRef: string,
  input: ApprovalInput,
  idempotencyKey: string,
  options: ReviewRequestOptions = {},
): Promise<ApprovalOutcome> {
  const sent = await postCommand(submissionRef, "approve", idempotencyKey, input, options);
  if ("failure" in sent) return sent.failure;
  if (!sent.response.ok) return mapFailure(sent.response);

  const parsed = ApprovalResultSchema.safeParse(await unwrap(sent.response));
  if (!parsed.success) return { status: "malformed_response" };
  return { status: "success", result: parsed.data };
}
