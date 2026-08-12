/**
 * G3 — bounded same-origin proxy for the Curriculum V2 learner MENTOR REVIEW
 * REQUEST write route (SERVER-ONLY).
 *
 * WHY THIS EXISTS
 * `mentor-review.ts` shipped both halves of the lifecycle and nothing in the
 * Academy could reach the learner half, so the 7 canonical mentor-review levels
 * could never leave `in_progress`: the learner could not submit, and therefore
 * no reviewer could ever have anything to approve.
 *
 * THE REQUEST HAS NO BODY. This is the canonical contract, not a simplification:
 * a mentor-review level carries no report, no rubric and no artifact upload, so
 * the learner's submission IS the state transition `in_progress ->
 * pending_review` and nothing else. The Backend takes the actor from the session
 * and the level from the path.
 *
 *   mentor-review-request -> POST /api/curriculum/v2/levels/{stableCode}/mentor-review/request
 *
 * WHAT THIS PROXY CANNOT DO. It exposes exactly one operation against one pinned
 * path shape. It cannot reach the reviewer's approve route — that is a staff
 * surface, lives on the CRM origin, and is not proxied by the Academy under any
 * path. No host, absolute URL, GET or arbitrary path is ever accepted, which is
 * what keeps SSRF structurally impossible.
 */
import { getAcademyConfig, AcademyConfigError } from "@/config/academy-config";
import { makeError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

export type MentorReviewProxyInput = {
  operation: "mentor-review-request";
  stableCode: string;
};

/** stableCode: conservative identity charset, bounded length (matches Backend). */
const STABLE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const MAX_MENTOR_REVIEW_RESPONSE_BYTES = 64 * 1024;

const FORWARD_REQUEST_HEADERS = new Set([
  "cookie",
  "x-csrf-token",
  "accept",
  REQUEST_ID_HEADER,
]);
const FORWARD_RESPONSE_HEADERS = new Set([
  "content-type",
  "cache-control",
  REQUEST_ID_HEADER,
]);

function errorResponse(error: NormalizedError, status: number): Response {
  return new Response(JSON.stringify(error), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function buildForwardHeaders(request: Request): Headers {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (FORWARD_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  return headers;
}

function copyResponseHeaders(from: Headers, to: Headers): void {
  from.forEach((value, key) => {
    if (FORWARD_RESPONSE_HEADERS.has(key.toLowerCase())) to.set(key, value);
  });
  if (!to.has("cache-control")) to.set("cache-control", "no-store");
}

function resolveTargetPath(input: MentorReviewProxyInput): string | null {
  if (!STABLE_CODE_RE.test(input.stableCode)) return null;
  return `/api/curriculum/v2/levels/${encodeURIComponent(input.stableCode)}/mentor-review/request`;
}

export async function proxyMentorReviewRequest(
  request: Request,
  input: MentorReviewProxyInput,
): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 405 }), 405);
  }

  let config;
  try {
    config = getAcademyConfig();
  } catch (error) {
    if (error instanceof AcademyConfigError) return errorResponse(makeError("CONFIGURATION_ERROR"), 500);
    throw error;
  }
  if (config.mode !== "api" || !config.backendOrigin) {
    return errorResponse(makeError("CONFIGURATION_ERROR"), 500);
  }

  const path = resolveTargetPath(input);
  if (path === null) {
    // Bounded rejection WITHOUT contacting Backend.
    return errorResponse(makeError("VALIDATION_ERROR", { status: 400 }), 400);
  }

  const target = `${config.backendOrigin}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  let backendResponse: Response;
  try {
    // NO BODY IS FORWARDED AT ALL. Not the incoming one, not an empty object —
    // the Backend route takes none, and forwarding whatever a client sent would
    // be the one way this proxy could smuggle a field into a command that has
    // deliberately never had one.
    backendResponse = await fetch(target, {
      method: "POST",
      headers: buildForwardHeaders(request),
      redirect: "manual",
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    const requestId = request.headers.get(REQUEST_ID_HEADER);
    const aborted = error instanceof Error && error.name === "AbortError";
    // No retry: the Backend transition is idempotent, so a retry would be safe,
    // but retrying silently would turn a real outage into an apparent success.
    return errorResponse(makeError(aborted ? "NETWORK_ERROR" : "BACKEND_UNAVAILABLE", { requestId }), 502);
  } finally {
    clearTimeout(timeout);
  }

  const body = await backendResponse.arrayBuffer();
  if (body.byteLength > MAX_MENTOR_REVIEW_RESPONSE_BYTES) {
    return errorResponse(makeError("MALFORMED_RESPONSE", { status: backendResponse.status }), 502);
  }

  const outHeaders = new Headers();
  copyResponseHeaders(backendResponse.headers, outHeaders);
  return new Response(body, { status: backendResponse.status, headers: outHeaders });
}
