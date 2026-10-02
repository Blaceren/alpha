/**
 * Bounded same-origin proxy for the Pocket REGISTRATION owners (SERVER-ONLY).
 *
 * Exposes exactly TWO operations, each pinned to one constant Backend path:
 *
 *   referral-link      -> POST /api/exchange/referral-link
 *   registration-check -> POST /api/exchange/registration/check
 *
 * THE SECOND ONE (2026-10-02). In the 30-level program the registration level
 * stands third, so a learner may register with Pocket while still on a lesson
 * in front of it: the postback binds the identity and completes nothing, since
 * the level is not theirs yet. `registration-check` is how that is settled once
 * they stand on the level — the Backend looks at its own authenticated identity
 * row and completes the level if, and only if, the registration is already a
 * fact. Nothing in the request can assert that it is: there is no body.
 *
 * WHY POST AND NOT GET
 * The Backend owner is a state-mutating, CSRF-protected POST: it mints the
 * learner's `clickid`, upserts their `ExchangeAccount` and writes an audit
 * record. Exposing that behind a GET — here or in the Backend — would make
 * clickid creation triggerable by any cross-site prefetch or `<img src>`, since
 * the session cookie rides along on a safe-method request. So the method stays
 * POST and the browser's CSRF token is forwarded. Every other method is refused
 * with 405 before the Backend is contacted at all.
 *
 * THE CSRF TOKEN IS THE BROWSER'S, NEVER THIS SERVER'S
 * The token is forwarded from the caller. This proxy does not fetch, mint or
 * synthesise one: a server-minted token would defeat the double-submit check it
 * is supposed to satisfy, turning the proxy itself into the confused deputy.
 *
 * NO SSRF SURFACE
 * The Backend path is a constant in this file. Nothing about the destination is
 * derived from caller input — no host, no absolute URL, no path segment, no
 * query, no redirect following. There is no parameter through which a caller
 * could nominate a different upstream.
 *
 * THE REQUEST HAS NO BODY. Obtaining one's own referral link takes no learner
 * input: the Backend derives the learner from the session. A body is refused
 * outright rather than forwarded and ignored, so there is no field through which
 * a learner could nominate another person, a clickid or a target URL.
 */
import { getAcademyConfig, AcademyConfigError } from "@/config/academy-config";
import { makeError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

export type ReferralLinkProxyInput = {
  operation: "referral-link" | "registration-check";
};

/** The Backend paths this proxy may ever reach — constants, one per operation. */
export const REFERRAL_LINK_BACKEND_PATH = "/api/exchange/referral-link";
export const REGISTRATION_CHECK_BACKEND_PATH = "/api/exchange/registration/check";

const BACKEND_PATHS: Readonly<Record<ReferralLinkProxyInput["operation"], string>> = {
  "referral-link": REFERRAL_LINK_BACKEND_PATH,
  "registration-check": REGISTRATION_CHECK_BACKEND_PATH,
};

/** A referral link is a short JSON envelope; anything larger is malformed. */
export const MAX_REFERRAL_LINK_RESPONSE_BYTES = 8 * 1024;

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
  // A learner-specific affiliate link must never be stored in a shared cache:
  // the next learner would be handed the previous learner's clickid, and every
  // registration after that would be attributed to the wrong person.
  to.set("cache-control", "no-store");
}

export async function proxyReferralLink(
  request: Request,
  input: ReferralLinkProxyInput,
): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 405 }), 405);
  }
  // Defensive: the route binds this, but a future caller must not be able to
  // widen the operation into another destination. `Object.hasOwn`, so a name
  // inherited from Object.prototype can never resolve to a path.
  if (!Object.hasOwn(BACKEND_PATHS, input.operation)) {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 400 }), 400);
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

  const raw = await request.arrayBuffer();
  if (raw.byteLength > 0) {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 400 }), 400);
  }

  const target = `${config.backendOrigin}${BACKEND_PATHS[input.operation]}`;
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
    // No retry. The Backend owner is idempotent for an existing clickid, but a
    // silent retry would hide a real outage behind a link the learner never got.
    return errorResponse(makeError(aborted ? "NETWORK_ERROR" : "BACKEND_UNAVAILABLE", { requestId }), 502);
  } finally {
    clearTimeout(timeout);
  }

  const body = await backendResponse.arrayBuffer();
  if (body.byteLength > MAX_REFERRAL_LINK_RESPONSE_BYTES) {
    return errorResponse(makeError("MALFORMED_RESPONSE", { status: backendResponse.status }), 502);
  }

  const outHeaders = new Headers();
  copyResponseHeaders(backendResponse.headers, outHeaders);
  return new Response(body, { status: backendResponse.status, headers: outHeaders });
}
