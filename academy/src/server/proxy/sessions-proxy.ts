/**
 * The learner's own sessions, listed and closed through the same-origin boundary
 * (owner 2026-10-07: «в профиле снизу есть сеансы они должны быть там показаны и
 * возможность закрыть сеанс с другого сеанса»).
 *
 * Bounded like every other proxy in this directory: the Backend path is a
 * CONSTANT per operation, and the only caller-controlled input is one session id,
 * matched against a strict charset and length before it is placed in a fixed
 * template — so SSRF is structurally impossible.
 *
 * SCOPE. Two named operations:
 *   - list  GET  /api/auth/sessions            → Backend GET
 *   - close POST /api/auth/sessions/{id}/close → Backend DELETE /api/auth/sessions/{id}
 *
 * The browser says POST to the Academy, as for every other write here; the
 * Backend checks the CSRF pair and that the session is the caller's own. Nothing
 * that comes back carries a token: the Backend answers with ids, times and the
 * device's coarse name only.
 */
import { getAcademyConfig, AcademyConfigError } from "@/config/academy-config";
import { makeError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

const BACKEND_PATH = "/api/auth/sessions";

/** A session row's id (a cuid): lowercase letters and digits, bounded. */
const SESSION_ID_RE = /^[a-z0-9]{20,40}$/;

/** Two sessions of a few short fields. */
export const MAX_SESSIONS_RESPONSE_BYTES = 32 * 1024;

const READ_HEADERS = new Set(["cookie", "accept", REQUEST_ID_HEADER]);
const WRITE_HEADERS = new Set(["cookie", "x-csrf-token", "accept", REQUEST_ID_HEADER]);
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
  return { config: { backendOrigin: config.backendOrigin, requestTimeoutMs: config.requestTimeoutMs } };
}

async function forward(
  request: Request,
  config: ResolvedConfig,
  method: "GET" | "DELETE",
  backendPath: string,
): Promise<Response> {
  const headers = buildHeaders(request, method === "GET" ? READ_HEADERS : WRITE_HEADERS);
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
  if (raw.byteLength > MAX_SESSIONS_RESPONSE_BYTES) {
    return errorResponse(makeError("BACKEND_UNAVAILABLE"), 502);
  }

  const out = new Headers();
  backendResponse.headers.forEach((value, key) => {
    if (RESPONSE_HEADERS.has(key.toLowerCase())) out.set(key, value);
  });
  out.set("cache-control", "no-store");
  return new Response(raw, { status: backendResponse.status, headers: out });
}

/** list — GET /api/auth/sessions. */
export async function proxyListSessions(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 405 }), 405);
  }
  const resolved = resolveConfig();
  if ("failure" in resolved) return resolved.failure;
  return forward(request, resolved.config, "GET", BACKEND_PATH);
}

/**
 * close — POST /api/auth/sessions/{id}/close → Backend DELETE.
 *
 * The id is validated BEFORE any Backend request is built; a refusal is a 400
 * that never reaches the Backend.
 */
export async function proxyCloseSession(request: Request, id: string): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 405 }), 405);
  }
  if (!SESSION_ID_RE.test(id)) {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 400 }), 400);
  }
  const resolved = resolveConfig();
  if ("failure" in resolved) return resolved.failure;
  return forward(request, resolved.config, "DELETE", `${BACKEND_PATH}/${encodeURIComponent(id)}`);
}
