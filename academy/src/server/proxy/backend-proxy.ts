/**
 * Same-origin Backend proxy core (SERVER-ONLY).
 *
 * The browser calls an Academy same-origin path (e.g. POST /api/backend/auth/login).
 * A thin route handler calls `proxyToBackend(request, operation)`. This module:
 *   - resolves the ONE server-only Backend origin (never a caller-supplied host);
 *   - forwards only a required, safe subset of headers;
 *   - strips hop-by-hop headers;
 *   - bounds the request body size and the request timeout;
 *   - preserves Set-Cookie, Cache-Control and the request id;
 *   - never logs credentials, cookies or raw bodies;
 *   - returns a normalized, safe failure on network/config errors.
 */
import { getAcademyConfig, AcademyConfigError } from "@/config/academy-config";
import { makeError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";
import { getProxyRoute, type ProxyOperation, type ProxyRoute } from "@/server/proxy/allow-list";
import { BACKEND_AUTH_SURFACE_HEADER } from "@/server/proxy/auth-surface";
import { deriveTrustedClientIp, FORWARDED_CLIENT_IP_HEADERS } from "@/server/proxy/client-ip";

/** 64 KiB is far more than any auth payload needs. */
export const MAX_BODY_BYTES = 64 * 1024;

/** Request headers we are willing to forward browser -> Backend. Everything else is dropped. */
const FORWARD_REQUEST_HEADERS = new Set([
  "content-type",
  "cookie",
  "x-csrf-token",
  "accept",
  REQUEST_ID_HEADER,
]);

/** Response headers we copy Backend -> browser (besides Set-Cookie, handled separately). */
const FORWARD_RESPONSE_HEADERS = new Set([
  "content-type",
  "cache-control",
  REQUEST_ID_HEADER,
]);

function errorResponse(error: NormalizedError, status: number): Response {
  return new Response(JSON.stringify(error), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function buildForwardHeaders(request: Request, route: ProxyRoute): Headers {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (FORWARD_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  // The allow-list above already drops every client-controlled forwarding
  // header. For IP-rate-limited operations we re-add exactly one address — the
  // one the trusted ingress hop measured — under both header names Backend
  // consults. `set` (not `append`) guarantees a single-element chain that the
  // browser had no part in. `null` means "no trustworthy value": we forward
  // nothing rather than guessing.
  if (route.forwardClientIp) {
    const clientIp = deriveTrustedClientIp(request);
    if (clientIp !== null) {
      for (const header of FORWARDED_CLIENT_IP_HEADERS) {
        headers.set(header, clientIp);
      }
    }
  }

  // AFD-3A3: name the authentication surface, from the allow-list constant and
  // from nowhere else. `set` after the loop above, so even if the forwarded
  // allow-list ever grew this name by mistake, the browser's value is overwritten
  // rather than trusted. Operations that raise no challenge send nothing.
  if (route.authSurface !== null) {
    headers.set(BACKEND_AUTH_SURFACE_HEADER, route.authSurface);
  }

  return headers;
}

function copyResponseHeaders(from: Headers, to: Headers): void {
  from.forEach((value, key) => {
    if (FORWARD_RESPONSE_HEADERS.has(key.toLowerCase())) {
      to.set(key, value);
    }
  });
  // Preserve every Set-Cookie exactly (multiple cookies supported).
  const setCookies = typeof from.getSetCookie === "function" ? from.getSetCookie() : [];
  for (const cookie of setCookies) {
    to.append("set-cookie", cookie);
  }
  // Auth responses must never be cached if the Backend did not say otherwise.
  if (!to.has("cache-control")) {
    to.set("cache-control", "no-store");
  }
}

export async function proxyToBackend(
  request: Request,
  operation: ProxyOperation,
): Promise<Response> {
  const route = getProxyRoute(operation);

  // 1. Method allow-list.
  if (request.method !== route.method) {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 405 }), 405);
  }

  // 2. Configuration (fail-closed).
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
    // The proxy must never run in fixture mode (fixtures never touch Backend).
    return errorResponse(makeError("CONFIGURATION_ERROR"), 500);
  }

  // 3. Target is built ONLY from the trusted origin + the constant path.
  const target = `${config.backendOrigin}${route.backendPath}`;

  // 4. Bounded body.
  let body: BodyInit | undefined;
  if (route.hasBody) {
    const raw = await request.arrayBuffer();
    if (raw.byteLength > MAX_BODY_BYTES) {
      return errorResponse(makeError("VALIDATION_ERROR", { status: 413 }), 413);
    }
    body = raw;
  }

  // 5. Bounded timeout.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  let backendResponse: Response;
  try {
    backendResponse = await fetch(target, {
      method: route.method,
      headers: buildForwardHeaders(request, route),
      body,
      redirect: "manual",
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    const requestId = request.headers.get(REQUEST_ID_HEADER);
    const aborted = error instanceof Error && error.name === "AbortError";
    // A timeout/refused connection is a transient, retryable network failure.
    return errorResponse(
      makeError(aborted ? "NETWORK_ERROR" : "BACKEND_UNAVAILABLE", { requestId }),
      502,
    );
  } finally {
    clearTimeout(timeout);
  }

  // 6. Re-emit a safe response (status, allow-listed headers, Set-Cookie).
  const outHeaders = new Headers();
  copyResponseHeaders(backendResponse.headers, outHeaders);
  const responseBody = await backendResponse.arrayBuffer();

  return new Response(responseBody, {
    status: backendResponse.status,
    headers: outHeaders,
  });
}
