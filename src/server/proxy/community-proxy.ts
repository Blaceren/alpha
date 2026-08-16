/**
 * Bounded same-origin proxy for the learner's COMMUNITY routes (SERVER-ONLY).
 *
 * Like every other proxy in this directory it is NOT an arbitrary forwarder. It
 * exposes exactly seven learner operations, each pinned to one HTTP method and
 * one constant Backend path shape:
 *
 *   community-overview     GET  /api/community/overview
 *   community-space        GET  /api/community/spaces/{spaceCode}
 *   community-create       POST /api/community/spaces/{spaceCode}/discussions
 *   community-thread       GET  /api/community/discussions/{discussionId}
 *   community-reply        POST /api/community/discussions/{discussionId}/replies
 *   community-report       POST /api/community/content/report
 *   community-remove       POST /api/community/content/remove
 *
 * THE ONLY CALLER-CONTROLLED INPUT IS A VALIDATED CODE OR ID. No host, no
 * absolute URL, no arbitrary path and no query parameter is ever accepted,
 * which is what keeps SSRF structurally impossible. The browser never sees the
 * Backend origin.
 *
 * WHAT IS DELIBERATELY ABSENT, AND IT IS THE POINT OF THIS FILE.
 *
 * There is NO moderation route here. `/api/crm/v1/community/moderation` — the
 * report queue, the reporter identities, the removal reasons and the removed
 * bodies — is not reachable through this proxy or any other in this repository.
 * A learner origin can forward exactly the seven operations above, so a learner
 * cannot reach the staff surface even if they guess its path: the Academy
 * answers its own 404 without ever contacting Backend.
 *
 * That is the same three-layer isolation Support has: a separate route
 * namespace, a learner projection that never selects staff fields, and an
 * origin allow-list with no path to them.
 */
import { getAcademyConfig, AcademyConfigError } from "@/config/academy-config";
import { makeError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

export type CommunityProxyInput =
  | { operation: "community-overview" }
  | { operation: "community-space"; spaceCode: string }
  | { operation: "community-create"; spaceCode: string }
  | { operation: "community-thread"; discussionId: string }
  | { operation: "community-reply"; discussionId: string }
  | { operation: "community-report" }
  | { operation: "community-remove" };

/** A cuid, and nothing that could leave the path segment it belongs to. */
const DISCUSSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
/** `channel.start_questions` and nothing with a slash, a dot-dot or a query. */
const SPACE_CODE_RE = /^[a-z][a-z0-9_.]{2,63}$/;

/** A discussion body is prose. 16 KiB is far more than any post needs. */
export const MAX_COMMUNITY_BODY_BYTES = 16 * 1024;
/** A thread of 200 replies stays comfortably inside this. */
export const MAX_COMMUNITY_RESPONSE_BYTES = 512 * 1024;

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

function methodFor(operation: CommunityProxyInput["operation"]): Method {
  return operation === "community-overview" ||
    operation === "community-space" ||
    operation === "community-thread"
    ? "GET"
    : "POST";
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
  if (!to.has("cache-control")) to.set("cache-control", "no-store");
}

/** Null means "refuse here, without contacting Backend". */
export function resolveCommunityTargetPath(input: CommunityProxyInput): string | null {
  switch (input.operation) {
    case "community-overview":
      return "/api/community/overview";
    case "community-space": {
      if (!SPACE_CODE_RE.test(input.spaceCode)) return null;
      return `/api/community/spaces/${encodeURIComponent(input.spaceCode)}`;
    }
    case "community-create": {
      if (!SPACE_CODE_RE.test(input.spaceCode)) return null;
      return `/api/community/spaces/${encodeURIComponent(input.spaceCode)}/discussions`;
    }
    case "community-thread": {
      if (!DISCUSSION_ID_RE.test(input.discussionId)) return null;
      return `/api/community/discussions/${encodeURIComponent(input.discussionId)}`;
    }
    case "community-reply": {
      if (!DISCUSSION_ID_RE.test(input.discussionId)) return null;
      return `/api/community/discussions/${encodeURIComponent(input.discussionId)}/replies`;
    }
    case "community-report":
      return "/api/community/content/report";
    case "community-remove":
      return "/api/community/content/remove";
    default:
      return null;
  }
}

export async function proxyCommunity(
  request: Request,
  input: CommunityProxyInput,
): Promise<Response> {
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

  const path = resolveCommunityTargetPath(input);
  if (path === null) {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 400 }), 400);
  }

  let body: BodyInit | undefined;
  if (write) {
    const raw = await request.arrayBuffer();
    if (raw.byteLength > MAX_COMMUNITY_BODY_BYTES) {
      return errorResponse(makeError("VALIDATION_ERROR", { status: 413 }), 413);
    }
    body = raw;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${config.backendOrigin}${path}`, {
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
  if (out.byteLength > MAX_COMMUNITY_RESPONSE_BYTES) {
    return errorResponse(makeError("BACKEND_UNAVAILABLE"), 502);
  }

  const headers = new Headers();
  copyResponseHeaders(backendResponse.headers, headers);
  return new Response(out, { status: backendResponse.status, headers });
}
