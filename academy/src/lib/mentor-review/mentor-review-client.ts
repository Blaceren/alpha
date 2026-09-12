/**
 * The Academy learner MENTOR REVIEW client (browser).
 *
 * Component code never calls `fetch` directly. This targets the Academy
 * same-origin proxy (`/api/backend/*`), so the httpOnly session cookie is sent
 * by the browser and no token is handled in JS. The write is CSRF-protected
 * (double-submit) via a bootstrapped token, exactly like the other learner
 * clients.
 *
 * THE REQUEST HAS NO BODY. That is the canonical mentor-review contract, not a
 * simplification: the level carries no report, no rubric and no artifact upload,
 * so submitting IS the transition `in_progress -> pending_review`. There is no
 * field here through which a learner could send a score, a comment, a reviewer
 * or another learner.
 *
 * THE LEARNER CANNOT APPROVE. There is deliberately no approve function in this
 * module. Approval is a staff command on a different origin, and the Backend
 * refuses it for the learner who owns the enrollment even if they reach it.
 *
 * NO AUTOMATIC RETRY. The Backend transition is idempotent, so a retry would be
 * harmless — but retrying silently would turn a real outage into an apparent
 * success and leave the learner believing their work is queued when it is not.
 */
import {
  makeError,
  normalizeHttpError,
  REQUEST_ID_HEADER,
  type NormalizedError,
} from "@/lib/api/errors";
import { isBackendCsrfResponse } from "@/lib/api/types";

const PROXY_BASE = "/api/backend";
const MAX_RESPONSE_BYTES = 16 * 1024;

/** The Backend's submission receipt, as the Academy is allowed to see it. */
export type MentorReviewRequestResult = {
  /** False when the level was already awaiting review. */
  created: boolean;
  state: "pending_review";
  levelNumber: number;
  stableCode: string;
  requestedAt: string;
};

export type MentorReviewApiResult =
  | { ok: true; data: MentorReviewRequestResult; requestId: string | null }
  | { ok: false; error: NormalizedError };

async function readBoundedJson(
  response: Response,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return { ok: false };
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

async function fetchCsrfToken(signal?: AbortSignal): Promise<
  { ok: true; token: string } | { ok: false; error: NormalizedError }
> {
  let response: Response;
  try {
    response = await fetch(`${PROXY_BASE}/csrf`, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR") };
  }
  const requestId = response.headers.get(REQUEST_ID_HEADER);
  const parsed = await readBoundedJson(response);
  if (!response.ok) {
    return {
      ok: false,
      error: normalizeHttpError({
        status: response.status,
        body: parsed.ok ? parsed.value : undefined,
        requestId,
      }),
    };
  }
  if (!parsed.ok || !isBackendCsrfResponse(parsed.value)) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE", { status: response.status, requestId }) };
  }
  return { ok: true, token: parsed.value.csrfToken };
}

function isMentorReviewEnvelope(value: unknown): value is { data: MentorReviewRequestResult } {
  if (typeof value !== "object" || value === null) return false;
  const data = (value as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    typeof record.created === "boolean" &&
    record.state === "pending_review" &&
    typeof record.levelNumber === "number" &&
    typeof record.stableCode === "string" &&
    typeof record.requestedAt === "string"
  );
}

/** Submit the learner's current mentor-review level for review. */
export async function requestMentorReview(
  stableCode: string,
  signal?: AbortSignal,
): Promise<MentorReviewApiResult> {
  const csrf = await fetchCsrfToken(signal);
  if (!csrf.ok) return { ok: false, error: csrf.error };

  let response: Response;
  try {
    response = await fetch(
      `${PROXY_BASE}/curriculum/levels/${encodeURIComponent(stableCode)}/mentor-review/request`,
      {
        method: "POST",
        headers: { accept: "application/json", "x-csrf-token": csrf.token },
        credentials: "same-origin",
        cache: "no-store",
        signal,
      },
    );
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR") };
  }

  const requestId = response.headers.get(REQUEST_ID_HEADER);
  const parsed = await readBoundedJson(response);
  if (!response.ok) {
    return {
      ok: false,
      error: normalizeHttpError({
        status: response.status,
        body: parsed.ok ? parsed.value : undefined,
        requestId,
      }),
    };
  }
  if (!parsed.ok || !isMentorReviewEnvelope(parsed.value)) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE", { status: response.status, requestId }) };
  }
  return { ok: true, data: parsed.value.data, requestId };
}
