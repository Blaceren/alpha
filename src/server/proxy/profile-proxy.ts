/**
 * The learner's own display name, updated through the same-origin boundary.
 *
 * ONE OPERATION, AND THE BODY IS BUILT HERE RATHER THAN FORWARDED.
 *
 * That second half is the important one. The Backend's `PATCH /api/me` accepts
 * `{ name?, email? }`, and an `email` in that payload starts a pending-email
 * change with its own verification flow and its own audit action. The Academy
 * Profile is documented as narrow — identity and session, nothing else — and
 * "editable identity and security fields must not be widened without a separate
 * product ruling". Passing the caller's JSON straight through would widen it by
 * accident the moment anyone crafted a request, so this reads exactly one field
 * out of the request and constructs a fresh `{ name }` body. `email` cannot
 * reach the Backend through this route because it is never copied into anything
 * that is sent.
 *
 * The name is validated to the Backend's own contract — trimmed, 2 to 50 — before
 * a Backend request is built, so a refusal is a 400 that never leaves the
 * Academy. The Backend validates it again; that is not redundancy, it is the
 * boundary each side is responsible for.
 *
 * CSRF IS THE BACKEND'S. The token is forwarded, not minted or checked here.
 */
import { getAcademyConfig, AcademyConfigError } from "@/config/academy-config";
import { makeError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

const BACKEND_PATH = "/api/me";
const NAME_MIN = 2;
const NAME_MAX = 50;
const MAX_REQUEST_BYTES = 4 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024;

const WRITE_REQUEST_HEADERS = new Set([
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

export async function proxyUpdateProfileName(request: Request): Promise<Response> {
  if (request.method !== "PATCH") {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 405 }), 405);
  }

  let config;
  try {
    config = getAcademyConfig();
  } catch (error) {
    if (error instanceof AcademyConfigError) {
      return errorResponse(makeError("CONFIGURATION_ERROR"), 500);
    }
    throw error;
  }
  if (config.mode !== "api" || !config.backendOrigin) {
    return errorResponse(makeError("CONFIGURATION_ERROR"), 500);
  }

  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_REQUEST_BYTES) {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 400 }), 400);
  }

  let name: string;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (typeof parsed !== "object" || parsed === null) throw new Error("shape");
    const value = (parsed as { name?: unknown }).name;
    if (typeof value !== "string") throw new Error("type");
    name = value.trim();
  } catch {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 400 }), 400);
  }
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 400 }), 400);
  }

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (WRITE_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("content-type", "application/json");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${config.backendOrigin}${BACKEND_PATH}`, {
      method: "PATCH",
      headers,
      /* The ONLY field that crosses. Nothing from the caller's JSON is reused. */
      body: JSON.stringify({ name }),
      redirect: "manual",
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    const requestId = request.headers.get(REQUEST_ID_HEADER);
    const aborted = error instanceof Error && error.name === "AbortError";
    return errorResponse(
      makeError(aborted ? "NETWORK_ERROR" : "BACKEND_UNAVAILABLE", { requestId }),
      502,
    );
  } finally {
    clearTimeout(timeout);
  }

  const body = await backendResponse.arrayBuffer();
  if (body.byteLength > MAX_RESPONSE_BYTES) {
    return errorResponse(makeError("BACKEND_UNAVAILABLE"), 502);
  }

  const out = new Headers();
  backendResponse.headers.forEach((value, key) => {
    if (RESPONSE_HEADERS.has(key.toLowerCase())) out.set(key, value);
  });
  out.set("cache-control", "no-store");
  return new Response(body, { status: backendResponse.status, headers: out });
}
