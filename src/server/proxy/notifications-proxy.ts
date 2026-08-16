/**
 * The learner's own notification list, read through the same-origin boundary.
 *
 * Bounded exactly like every other proxy in this directory, and for the same
 * reason: the Backend path is a CONSTANT here. Nothing in it is derived from the
 * caller — no host, no absolute URL, no path segment, no query — which is what
 * makes SSRF structurally impossible rather than merely unlikely.
 *
 * SCOPE. One operation, GET only. There is deliberately no passthrough for
 * `/api/notifications/:id/read` or `read-all` yet: this phase renders the list,
 * and an unused write path is an attack surface with no product behind it. When
 * read-state lands it gets its own named entry, not a wildcard.
 *
 * WHAT CANNOT COME BACK THROUGH HERE. Learner Operations internal notes are not
 * in the Notification model at all — they live in a physically separate table
 * that this Backend route never joins. The isolation is structural, so it does
 * not depend on this file filtering anything out.
 */
import { getAcademyConfig, AcademyConfigError } from "@/config/academy-config";
import { makeError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

const BACKEND_PATH = "/api/notifications";

/** 50 notifications of prose metadata stays far inside this. */
export const MAX_NOTIFICATIONS_RESPONSE_BYTES = 256 * 1024;

const REQUEST_HEADERS = new Set(["cookie", "accept", REQUEST_ID_HEADER]);
const RESPONSE_HEADERS = new Set(["content-type", "cache-control", REQUEST_ID_HEADER]);

function errorResponse(error: NormalizedError, status: number): Response {
  return new Response(JSON.stringify(error), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function proxyBackendJson(request: Request): Promise<Response> {
  if (request.method !== "GET") {
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

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${config.backendOrigin}${BACKEND_PATH}`, {
      method: "GET",
      headers,
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

  const raw = await backendResponse.arrayBuffer();
  if (raw.byteLength > MAX_NOTIFICATIONS_RESPONSE_BYTES) {
    return errorResponse(makeError("BACKEND_UNAVAILABLE"), 502);
  }

  const out = new Headers();
  backendResponse.headers.forEach((value, key) => {
    if (RESPONSE_HEADERS.has(key.toLowerCase())) out.set(key, value);
  });
  out.set("cache-control", "no-store");
  return new Response(raw, { status: backendResponse.status, headers: out });
}
