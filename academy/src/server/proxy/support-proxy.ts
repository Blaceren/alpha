/**
 * Bounded same-origin proxy for the learner's LEARNER OPERATIONS support routes
 * (SERVER-ONLY).
 *
 * Like every other proxy in this directory, it is NOT an arbitrary forwarder: it
 * exposes exactly three learner operations, each pinned to one HTTP method and
 * one constant Backend path shape.
 *
 *   support-list     GET  /api/learner-ops/cases
 *   support-open     POST /api/learner-ops/cases
 *   support-detail   GET  /api/learner-ops/cases/{caseId}
 *   support-reply    POST /api/learner-ops/cases/{caseId}/messages
 *
 * THE ONLY CALLER-CONTROLLED INPUT IS A VALIDATED `caseId`. No host, no absolute
 * URL, no arbitrary path and no query parameter is ever accepted, which is what
 * keeps SSRF structurally impossible. The browser never sees the Backend origin.
 *
 * WHAT IS DELIBERATELY ABSENT, AND IT IS THE POINT OF THIS FILE.
 *
 * There is NO staff route here. `/api/crm/v1/learner-ops/**` — the queue, the
 * internal notes, Learner 360, the analytics — is not reachable through this
 * proxy or any other in this repository. The learner origin can forward exactly
 * the four operations above and nothing else, so a learner cannot reach a staff
 * surface even if they guess its path: the Academy answers its own 404 without
 * ever contacting Backend.
 *
 * THE INTERNAL-NOTE TABLE HAS NO PATH AT ALL. There is no Backend route that
 * returns `LearnerOpsNote` to a learner, so there is nothing here that could
 * forward one. That is the third independent layer of the same invariant: a
 * separate table, a learner projection that never selects it, and an origin
 * allowlist with no route to it.
 */
import { getAcademyConfig, AcademyConfigError } from "@/config/academy-config";
import { makeError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

export type SupportProxyInput =
  | { operation: "support-list" }
  | { operation: "support-open" }
  | { operation: "support-detail"; caseId: string }
  | { operation: "support-reply"; caseId: string };

/**
 * caseId: the Backend mints cuids. This is a conservative identity charset with
 * a bounded length — it admits a cuid and refuses a path traversal, a query
 * string, an absolute URL and anything containing a slash.
 */
const CASE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

/** A support message is prose. 16 KiB is far more than any reply needs. */
export const MAX_SUPPORT_BODY_BYTES = 16 * 1024;
/** A thread of 200 messages stays comfortably inside this. */
export const MAX_SUPPORT_RESPONSE_BYTES = 512 * 1024;

const READ_REQUEST_HEADERS = new Set(["cookie", "accept", REQUEST_ID_HEADER]);
const WRITE_REQUEST_HEADERS = new Set([
  "content-type",
  "cookie",
  "x-csrf-token",
  "accept",
  REQUEST_ID_HEADER,
]);
const FORWARD_RESPONSE_HEADERS = new Set(["content-type", "cache-control", REQUEST_ID_HEADER]);

type Method = "GET" | "POST";

function methodFor(operation: SupportProxyInput["operation"]): Method {
  return operation === "support-open" || operation === "support-reply" ? "POST" : "GET";
}

function errorResponse(error: NormalizedError, status: number): Response {
  return new Response(JSON.stringify(error), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function buildForwardHeaders(request: Request, write: boolean): Headers {
  const allow = write ? WRITE_REQUEST_HEADERS : READ_REQUEST_HEADERS;
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (allow.has(key.toLowerCase())) headers.set(key, value);
  });
  return headers;
}

function copyResponseHeaders(from: Headers, to: Headers): void {
  from.forEach((value, key) => {
    if (FORWARD_RESPONSE_HEADERS.has(key.toLowerCase())) to.set(key, value);
  });
  // A support thread is never cacheable unless Backend says so.
  if (!to.has("cache-control")) to.set("cache-control", "no-store");
}

export function resolveSupportTargetPath(input: SupportProxyInput): string | null {
  const root = "/api/learner-ops/cases";
  switch (input.operation) {
    case "support-list":
    case "support-open":
      return root;
    case "support-detail": {
      if (!CASE_ID_RE.test(input.caseId)) return null;
      return `${root}/${encodeURIComponent(input.caseId)}`;
    }
    case "support-reply": {
      if (!CASE_ID_RE.test(input.caseId)) return null;
      return `${root}/${encodeURIComponent(input.caseId)}/messages`;
    }
    default:
      return null;
  }
}

export async function proxySupport(request: Request, input: SupportProxyInput): Promise<Response> {
  const method = methodFor(input.operation);
  const write = method !== "GET";

  if (request.method !== method) {
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

  const path = resolveSupportTargetPath(input);
  if (path === null) {
    // Bounded rejection WITHOUT contacting Backend (invalid case id).
    return errorResponse(makeError("VALIDATION_ERROR", { status: 400 }), 400);
  }

  let body: BodyInit | undefined;
  if (write) {
    const raw = await request.arrayBuffer();
    if (raw.byteLength > MAX_SUPPORT_BODY_BYTES) {
      return errorResponse(makeError("VALIDATION_ERROR", { status: 413 }), 413);
    }
    body = raw;
  }

  const target = `${config.backendOrigin}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  let backendResponse: Response;
  try {
    backendResponse = await fetch(target, {
      method,
      headers: buildForwardHeaders(request, write),
      body,
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

  const out = await backendResponse.arrayBuffer();
  if (out.byteLength > MAX_SUPPORT_RESPONSE_BYTES) {
    return errorResponse(makeError("BACKEND_UNAVAILABLE"), 502);
  }

  const headers = new Headers();
  copyResponseHeaders(backendResponse.headers, headers);
  return new Response(out, { status: backendResponse.status, headers });
}
