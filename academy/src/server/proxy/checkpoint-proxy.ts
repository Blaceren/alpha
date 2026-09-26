/**
 * Bounded same-origin proxy for the Curriculum V2 learner CHECKPOINT write route
 * (SERVER-ONLY).
 *
 * Like `assessment-proxy.ts` this is NOT an arbitrary forwarder: it exposes
 * exactly ONE POST operation, pinned to one constant Backend path shape. The
 * only caller-controlled input is a validated `stableCode` path segment; the
 * request body and the CSRF header are forwarded, nothing else.
 *
 *   checkpoint-verify -> POST /api/curriculum/v2/levels/{stableCode}/checkpoint/verify
 *
 * No host, absolute URL, GET or arbitrary path is ever accepted, which is what
 * keeps SSRF structurally impossible. The browser never sees the Backend origin.
 *
 * The forwarded body is capped at 4 KiB — the real body is `{ requestId }`, so
 * anything larger is a client that is trying to send something it should not.
 */
import { getAcademyConfig, AcademyConfigError } from "@/config/academy-config";
import { makeError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

export type CheckpointProxyInput = {
  operation: "checkpoint-verify";
  stableCode: string;
};

/** stableCode: conservative identity charset, bounded length (matches Backend). */
const STABLE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const MAX_CHECKPOINT_BODY_BYTES = 4 * 1024;
export const MAX_CHECKPOINT_RESPONSE_BYTES = 64 * 1024;

const FORWARD_REQUEST_HEADERS = new Set([
  "content-type",
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
  // A verification verdict about a person's money is never cacheable.
  if (!to.has("cache-control")) to.set("cache-control", "no-store");
}

function resolveTargetPath(input: CheckpointProxyInput): string | null {
  if (!STABLE_CODE_RE.test(input.stableCode)) return null;
  return `/api/curriculum/v2/levels/${encodeURIComponent(input.stableCode)}/checkpoint/verify`;
}

export async function proxyCheckpointVerify(
  request: Request,
  input: CheckpointProxyInput,
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

  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_CHECKPOINT_BODY_BYTES) {
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
    // No retry here either: the Backend may already be mid-verification.
    return errorResponse(makeError(aborted ? "NETWORK_ERROR" : "BACKEND_UNAVAILABLE", { requestId }), 502);
  } finally {
    clearTimeout(timeout);
  }

  const body = await backendResponse.arrayBuffer();
  if (body.byteLength > MAX_CHECKPOINT_RESPONSE_BYTES) {
    return errorResponse(makeError("MALFORMED_RESPONSE", { status: backendResponse.status }), 502);
  }

  const outHeaders = new Headers();
  copyResponseHeaders(backendResponse.headers, outHeaders);
  return new Response(body, { status: backendResponse.status, headers: outHeaders });
}
