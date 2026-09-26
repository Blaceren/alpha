/**
 * Read-only same-origin proxy for the Curriculum V2 learner read routes
 * (SERVER-ONLY). GET-only, bounded, and never an arbitrary forwarder.
 *
 * Exposes exactly two operations:
 *   - curriculum-current  -> GET /api/curriculum/v2/current
 *   - level-content       -> GET /api/curriculum/v2/levels/{stableCode}/content?locale=
 *
 * The Backend path is a constant per operation; the only caller-controlled input
 * is a validated stableCode path segment and a validated `locale` query value.
 * No host/absolute URL/body/write method is ever accepted.
 */
import { getAcademyConfig, AcademyConfigError } from "@/config/academy-config";
import { makeError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

export type CurriculumProxyOperation = "curriculum-current" | "level-content";

/** stableCode: conservative identity charset, bounded length. */
const STABLE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** locale: short BCP-47-ish token. */
const LOCALE_RE = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})?$/;

const FORWARD_REQUEST_HEADERS = new Set(["cookie", "accept", REQUEST_ID_HEADER]);
const FORWARD_RESPONSE_HEADERS = new Set([
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
  REQUEST_ID_HEADER,
]);

export const MAX_READ_RESPONSE_BYTES = 512 * 1024;

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
  // Never persist a learner's read as authority in a shared cache by default.
  if (!to.has("cache-control")) to.set("cache-control", "no-store");
}

export type CurriculumProxyInput =
  | { operation: "curriculum-current" }
  | { operation: "level-content"; stableCode: string; locale: string | null };

function resolveTargetPath(input: CurriculumProxyInput): string | null {
  if (input.operation === "curriculum-current") {
    return "/api/curriculum/v2/current";
  }
  // level-content
  if (!STABLE_CODE_RE.test(input.stableCode)) return null;
  if (input.locale === null || !LOCALE_RE.test(input.locale)) return null;
  const encoded = encodeURIComponent(input.stableCode);
  const query = `?locale=${encodeURIComponent(input.locale)}`;
  return `/api/curriculum/v2/levels/${encoded}/content${query}`;
}

export async function proxyCurriculumRead(request: Request, input: CurriculumProxyInput): Promise<Response> {
  // GET only.
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

  const path = resolveTargetPath(input);
  if (path === null) {
    // Bounded rejection WITHOUT contacting Backend (invalid code/locale/path).
    return errorResponse(makeError("VALIDATION_ERROR", { status: 400 }), 400);
  }

  const target = `${config.backendOrigin}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  let backendResponse: Response;
  try {
    backendResponse = await fetch(target, {
      method: "GET",
      headers: buildForwardHeaders(request),
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
  if (body.byteLength > MAX_READ_RESPONSE_BYTES) {
    return errorResponse(makeError("MALFORMED_RESPONSE", { status: backendResponse.status }), 502);
  }

  const outHeaders = new Headers();
  copyResponseHeaders(backendResponse.headers, outHeaders);
  return new Response(body, { status: backendResponse.status, headers: outHeaders });
}
