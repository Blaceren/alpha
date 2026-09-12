/**
 * The learner's own notifications, read and marked through the same-origin
 * boundary.
 *
 * Bounded exactly like every other proxy in this directory, and for the same
 * reason: the Backend path is a CONSTANT PER OPERATION here. The only
 * caller-controlled input anywhere in this file is one notification id, matched
 * against a conservative charset and length before it is encoded into a fixed
 * template — which is what makes SSRF structurally impossible rather than merely
 * unlikely.
 *
 * SCOPE. Three named operations, each pinned to one method:
 *   - list      GET  /api/notifications
 *   - read-one  POST /api/notifications/{id}/read
 *   - read-all  POST /api/notifications/read-all
 *
 * The previous revision of this file carried exactly one operation and said of
 * the other two: "There is deliberately no passthrough for
 * `/api/notifications/:id/read` or `read-all` yet: this phase renders the list,
 * and an unused write path is an attack surface with no product behind it. When
 * read-state lands it gets its own named entry, not a wildcard."
 *
 * Read-state has now landed, and this is that named entry — two of them, not a
 * wildcard. `/api/notifications/*` is still not forwardable: an operation that
 * is not named here cannot be reached, so adjacent Backend notification routes
 * stay unreachable from the browser. In particular `/api/me/notification-settings`
 * is deliberately NOT exposed by this phase; it is a different resource with a
 * different shape and it gets its own entry when a surface actually needs it.
 *
 * BOTH BACKEND WRITE ROUTES ALREADY EXIST. The server audit confirmed
 * `/api/notifications/[id]/read` and `/api/notifications/read-all` are compiled
 * into the deployed Backend artifact. No Backend change was made, needed or
 * authorised for this work.
 *
 * WHAT CANNOT COME BACK THROUGH HERE. Learner Operations internal notes are not
 * in the Notification model at all — they live in a physically separate table
 * that these Backend routes never join. The isolation is structural, so it does
 * not depend on this file filtering anything out.
 */
import { getAcademyConfig, AcademyConfigError } from "@/config/academy-config";
import { makeError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

const BACKEND_PATH = "/api/notifications";
const BACKEND_READ_ALL_PATH = "/api/notifications/read-all";

/**
 * Notification id: conservative identity charset, bounded length — the same
 * shape of guard the curriculum proxy applies to a stableCode. Anything else is
 * refused before a Backend request is built, so a caller cannot smuggle a path
 * segment, a traversal or a query through this parameter.
 */
const NOTIFICATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** 50 notifications of prose metadata stays far inside this. */
export const MAX_NOTIFICATIONS_RESPONSE_BYTES = 256 * 1024;

const REQUEST_HEADERS = new Set(["cookie", "accept", REQUEST_ID_HEADER]);
/**
 * Marking a notification read is a state change, so it carries the same write
 * headers every other mutating proxy forwards: the CSRF token the Backend
 * requires, and an optional idempotency key. `content-type` is included for
 * symmetry with the other write proxies even though these two routes take no
 * body.
 */
const WRITE_REQUEST_HEADERS = new Set([
  "content-type",
  "cookie",
  "x-csrf-token",
  "idempotency-key",
  "accept",
  REQUEST_ID_HEADER,
]);
const RESPONSE_HEADERS = new Set(["content-type", "cache-control", REQUEST_ID_HEADER]);

function errorResponse(error: NormalizedError, status: number): Response {
  return new Response(JSON.stringify(error), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function buildHeaders(request: Request, allow: Set<string>): Headers {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (allow.has(key.toLowerCase())) headers.set(key, value);
  });
  return headers;
}

type ResolvedConfig = { backendOrigin: string; requestTimeoutMs: number };

/** Resolves config or returns the response to send instead. */
function resolveConfig(): { config: ResolvedConfig } | { failure: Response } {
  let config;
  try {
    config = getAcademyConfig();
  } catch (error) {
    if (error instanceof AcademyConfigError) {
      return { failure: errorResponse(makeError("CONFIGURATION_ERROR"), 500) };
    }
    throw error;
  }
  if (config.mode !== "api" || !config.backendOrigin) {
    return { failure: errorResponse(makeError("CONFIGURATION_ERROR"), 500) };
  }
  return {
    config: { backendOrigin: config.backendOrigin, requestTimeoutMs: config.requestTimeoutMs },
  };
}

async function forward(
  request: Request,
  config: ResolvedConfig,
  method: "GET" | "POST",
  backendPath: string,
): Promise<Response> {
  const headers = buildHeaders(request, method === "GET" ? REQUEST_HEADERS : WRITE_REQUEST_HEADERS);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${config.backendOrigin}${backendPath}`, {
      method,
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

/** list — GET /api/notifications. Behaviour unchanged from the previous revision. */
export async function proxyBackendJson(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 405 }), 405);
  }
  const resolved = resolveConfig();
  if ("failure" in resolved) return resolved.failure;
  return forward(request, resolved.config, "GET", BACKEND_PATH);
}

/**
 * read-one — POST /api/notifications/{id}/read.
 *
 * The id is validated BEFORE any Backend request is constructed, and refusal is
 * a 400 that never reaches the Backend at all.
 *
 * Idempotent by nature: marking an already-read notification read again is not
 * an error and changes nothing, which is why a retry after a dropped response
 * is safe and why no duplicate-guard is needed here.
 */
export async function proxyMarkNotificationRead(request: Request, id: string): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 405 }), 405);
  }
  if (!NOTIFICATION_ID_RE.test(id)) {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 400 }), 400);
  }
  const resolved = resolveConfig();
  if ("failure" in resolved) return resolved.failure;
  const path = `${BACKEND_PATH}/${encodeURIComponent(id)}/read`;
  return forward(request, resolved.config, "POST", path);
}

/**
 * read-all — POST /api/notifications/read-all.
 *
 * A constant path with no caller input of any kind. Also idempotent: a second
 * call marks nothing further.
 */
export async function proxyMarkAllNotificationsRead(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 405 }), 405);
  }
  const resolved = resolveConfig();
  if ("failure" in resolved) return resolved.failure;
  return forward(request, resolved.config, "POST", BACKEND_READ_ALL_PATH);
}
