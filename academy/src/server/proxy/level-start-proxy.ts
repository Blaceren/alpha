/**
 * Bounded same-origin proxy for the Curriculum V2 learner LEVEL START route
 * (SERVER-ONLY).
 *
 * Like `checkpoint-proxy.ts` this is NOT an arbitrary forwarder: it exposes
 * exactly ONE POST operation, pinned to one constant Backend path shape. The
 * only caller-controlled input is a validated `stableCode` path segment; the
 * CSRF header and session cookie are forwarded, nothing else.
 *
 *   level-start -> POST /api/curriculum/v2/levels/{stableCode}/start
 *
 * No host, absolute URL, GET or arbitrary path is ever accepted, which is what
 * keeps SSRF structurally impossible. The browser never sees the Backend origin.
 *
 * THE REQUEST HAS NO BODY AT ALL. Starting a level takes no learner input: the
 * Backend derives the actor from the session and starts that learner's current
 * level, and the stable code only asks it to refuse if that is not the level the
 * page named. So this proxy forwards an empty body and caps anything larger at
 * zero — there is no field through which a learner could nominate a level, a
 * status or another person.
 */
import { getAcademyConfig, AcademyConfigError } from "@/config/academy-config";
import { makeError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

export type LevelStartProxyInput = {
  operation: "level-start";
  stableCode: string;
};

/** stableCode: conservative identity charset, bounded length (matches Backend). */
const STABLE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const MAX_LEVEL_START_RESPONSE_BYTES = 16 * 1024;

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
  // A learner's progression state is never cacheable.
  if (!to.has("cache-control")) to.set("cache-control", "no-store");
}

function resolveTargetPath(input: LevelStartProxyInput): string | null {
  if (!STABLE_CODE_RE.test(input.stableCode)) return null;
  return `/api/curriculum/v2/levels/${encodeURIComponent(input.stableCode)}/start`;
}

export async function proxyLevelStart(
  request: Request,
  input: LevelStartProxyInput,
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

  // A body would have nowhere legitimate to go, so one is refused outright
  // rather than forwarded and ignored.
  const raw = await request.arrayBuffer();
  if (raw.byteLength > 0) {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 400 }), 400);
  }

  const target = `${config.backendOrigin}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  let backendResponse: Response;
  try {
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
    // No retry: the Backend start is idempotent, but retrying here would hide a
    // real outage behind a success the learner never actually got.
    return errorResponse(makeError(aborted ? "NETWORK_ERROR" : "BACKEND_UNAVAILABLE", { requestId }), 502);
  } finally {
    clearTimeout(timeout);
  }

  const body = await backendResponse.arrayBuffer();
  if (body.byteLength > MAX_LEVEL_START_RESPONSE_BYTES) {
    return errorResponse(makeError("MALFORMED_RESPONSE", { status: backendResponse.status }), 502);
  }

  const outHeaders = new Headers();
  copyResponseHeaders(backendResponse.headers, outHeaders);
  return new Response(body, { status: backendResponse.status, headers: outHeaders });
}
