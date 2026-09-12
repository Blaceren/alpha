/**
 * G3 — bounded same-origin proxy for the Curriculum V2 learner MANUAL COMPLETION
 * write route (SERVER-ONLY).
 *
 * WHY THIS EXISTS
 * The Backend has always owned `lesson:manual` through `level_completion`, and
 * `POST /api/curriculum/v2/levels/{stableCode}/complete` has always implemented
 * it. Nothing in the Academy could reach that route, and nginx never proxies to
 * Backend, so the 13 canonical practical levels that carry no mentor review had
 * no learner-reachable completion path at all: the level stayed `in_progress`
 * forever and every later level stayed locked behind it.
 *
 * This adds the missing transport and NOTHING else. No completion semantic is
 * invented here: the Backend command resolves the enrollment, refuses a level
 * with a different owner, refuses a level that is not current or not started,
 * runs in one transaction, delegates to the canonical completion engine, and is
 * idempotent on the request identity. All of that is unchanged and is still the
 * only thing that decides whether a completion happens.
 *
 * Modelled deliberately on `checkpoint-proxy.ts`, which is the closest existing
 * analogue: one POST, one pinned Backend path shape, one validated path segment,
 * a `{ requestId }` body and nothing else.
 *
 *   manual-complete -> POST /api/curriculum/v2/levels/{stableCode}/complete
 *
 * No host, absolute URL, GET or arbitrary path is ever accepted, which is what
 * keeps SSRF structurally impossible. The browser never sees the Backend origin.
 *
 * WHAT THE CALLER CANNOT SUPPLY
 * A user id, an enrollment, a level id, an XP amount, a status or a completion
 * time. The learner comes from the forwarded session cookie and is read by the
 * Backend from that session; the level comes from the path. The body is capped
 * at 4 KiB because the real body is `{ requestId }` — anything larger is a
 * client trying to send something it should not.
 */
import { getAcademyConfig, AcademyConfigError } from "@/config/academy-config";
import { makeError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

export type ManualCompletionProxyInput = {
  operation: "manual-complete";
  stableCode: string;
};

/** stableCode: conservative identity charset, bounded length (matches Backend). */
const STABLE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const MAX_MANUAL_COMPLETION_BODY_BYTES = 4 * 1024;
export const MAX_MANUAL_COMPLETION_RESPONSE_BYTES = 64 * 1024;

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
  // A completion receipt names XP and an unlock. It is never cacheable.
  if (!to.has("cache-control")) to.set("cache-control", "no-store");
}

function resolveTargetPath(input: ManualCompletionProxyInput): string | null {
  if (!STABLE_CODE_RE.test(input.stableCode)) return null;
  return `/api/curriculum/v2/levels/${encodeURIComponent(input.stableCode)}/complete`;
}

export async function proxyManualCompletion(
  request: Request,
  input: ManualCompletionProxyInput,
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
  if (raw.byteLength > MAX_MANUAL_COMPLETION_BODY_BYTES) {
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
    // Deliberately NO retry. The Backend may already have committed the
    // completion; a retry from here would be a second request with the same
    // request id, which is safe, but the honest answer to "we do not know" is to
    // report it rather than to guess. The client owns the retry and owns the
    // request id, so its retry replays idempotently.
    return errorResponse(makeError(aborted ? "NETWORK_ERROR" : "BACKEND_UNAVAILABLE", { requestId }), 502);
  } finally {
    clearTimeout(timeout);
  }

  const body = await backendResponse.arrayBuffer();
  if (body.byteLength > MAX_MANUAL_COMPLETION_RESPONSE_BYTES) {
    return errorResponse(makeError("MALFORMED_RESPONSE", { status: backendResponse.status }), 502);
  }

  const outHeaders = new Headers();
  copyResponseHeaders(backendResponse.headers, outHeaders);
  return new Response(body, { status: backendResponse.status, headers: outHeaders });
}
