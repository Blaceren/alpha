/**
 * Bounded same-origin proxy for the Curriculum V2 learner ASSESSMENT write routes
 * (SERVER-ONLY). Like `curriculum-proxy.ts` this is NOT an arbitrary forwarder:
 * it exposes exactly two POST operations, each pinned to one constant Backend
 * path. The only caller-controlled inputs are a validated `stableCode` path
 * segment and a validated positive-integer `attemptId`; the request body and the
 * CSRF / Idempotency-Key headers are forwarded, nothing else.
 *
 *   assessment-start  -> POST /api/curriculum/v2/levels/{stableCode}/assessment/attempts
 *   assessment-submit -> POST /api/curriculum/v2/assessment/attempts/{attemptId}/submit
 *
 * No host / absolute URL / GET / arbitrary path is ever accepted, which is what
 * keeps SSRF structurally impossible. The browser never sees the Backend origin.
 */
import { getAcademyConfig, AcademyConfigError } from "@/config/academy-config";
import { makeError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

export type AssessmentProxyInput =
  | { operation: "assessment-start"; stableCode: string }
  | { operation: "assessment-submit"; attemptId: string };

/** stableCode: conservative identity charset, bounded length (matches Backend). */
const STABLE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** 64 KiB is far more than any assessment submission needs. */
export const MAX_ASSESSMENT_BODY_BYTES = 64 * 1024;
export const MAX_ASSESSMENT_RESPONSE_BYTES = 256 * 1024;

const FORWARD_REQUEST_HEADERS = new Set([
  "content-type",
  "cookie",
  "x-csrf-token",
  "idempotency-key",
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
  // A learner-graded response is never cacheable unless Backend says so.
  if (!to.has("cache-control")) to.set("cache-control", "no-store");
}

function resolveTargetPath(input: AssessmentProxyInput): string | null {
  if (input.operation === "assessment-start") {
    if (!STABLE_CODE_RE.test(input.stableCode)) return null;
    return `/api/curriculum/v2/levels/${encodeURIComponent(input.stableCode)}/assessment/attempts`;
  }
  // assessment-submit
  const id = Number(input.attemptId);
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== input.attemptId.trim()) return null;
  return `/api/curriculum/v2/assessment/attempts/${id}/submit`;
}

export async function proxyAssessmentWrite(request: Request, input: AssessmentProxyInput): Promise<Response> {
  // POST only.
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
    // Bounded rejection WITHOUT contacting Backend (invalid code / attemptId).
    return errorResponse(makeError("VALIDATION_ERROR", { status: 400 }), 400);
  }

  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_ASSESSMENT_BODY_BYTES) {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 413 }), 413);
  }

  const target = `${config.backendOrigin}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  let backendResponse: Response;
  try {
    backendResponse = await fetch(target, {
      method: "POST",
      headers: buildForwardHeaders(request),
      body: raw,
      redirect: "manual",
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    const requestId = request.headers.get(REQUEST_ID_HEADER);
    const aborted = error instanceof Error && error.name === "AbortError";
    return errorResponse(makeError(aborted ? "NETWORK_ERROR" : "BACKEND_UNAVAILABLE", { requestId }), 502);
  } finally {
    clearTimeout(timeout);
  }

  const body = await backendResponse.arrayBuffer();
  if (body.byteLength > MAX_ASSESSMENT_RESPONSE_BYTES) {
    return errorResponse(makeError("MALFORMED_RESPONSE", { status: backendResponse.status }), 502);
  }

  const outHeaders = new Headers();
  copyResponseHeaders(backendResponse.headers, outHeaders);
  return new Response(body, { status: backendResponse.status, headers: outHeaders });
}
