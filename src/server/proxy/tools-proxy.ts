/**
 * Bounded same-origin proxy for the learner's TOOL routes (SERVER-ONLY).
 *
 * Like every other proxy in this directory it is NOT an arbitrary forwarder. It
 * exposes exactly three learner operations, each pinned to one HTTP method and
 * one constant Backend path shape:
 *
 *   trade-card-state    GET   /api/tools/trade-cards
 *   trade-card-fix      POST  /api/tools/trade-cards
 *   trade-card-change   PATCH /api/tools/trade-cards/{cardId}
 *
 * THE ONLY CALLER-CONTROLLED INPUT IS A VALIDATED CARD ID. No host, no absolute
 * URL, no arbitrary path and no query parameter is ever accepted, which keeps
 * SSRF structurally impossible. The browser never sees the Backend origin.
 *
 * TOOL DATA BELONGS TO THE LEARNER (owner decision 2026-09-21). There is no
 * staff route here and none exists on the Backend: a mentor or a support agent
 * has nothing to reach through this file, and the Backend refuses any session
 * that is not an active learner.
 */
import { getAcademyConfig, AcademyConfigError } from "@/config/academy-config";
import { makeError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

export type ToolsProxyInput =
  | { operation: "trade-card-state" }
  | { operation: "trade-card-fix" }
  | { operation: "trade-card-change"; cardId: string };

/** A cuid, and nothing that could leave the path segment it belongs to. */
const CARD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

/** A plan is seven short fields and a reason of at most 1 000 characters. */
export const MAX_TOOLS_BODY_BYTES = 16 * 1024;
/** The card, or the card plus the two reference lists. */
export const MAX_TOOLS_RESPONSE_BYTES = 128 * 1024;

const READ_REQUEST_HEADERS = new Set(["cookie", "accept", REQUEST_ID_HEADER]);
const WRITE_REQUEST_HEADERS = new Set(["content-type", "cookie", "x-csrf-token", "accept", REQUEST_ID_HEADER]);
/* Cache-Control is NOT copied: a learner's tool data is private, so every
   answer is `no-store` whatever the Backend said. */
const FORWARD_RESPONSE_HEADERS = new Set(["content-type", REQUEST_ID_HEADER]);

type Method = "GET" | "POST" | "PATCH";

function methodFor(operation: ToolsProxyInput["operation"]): Method {
  switch (operation) {
    case "trade-card-state":
      return "GET";
    case "trade-card-fix":
      return "POST";
    case "trade-card-change":
      return "PATCH";
  }
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
  to.set("cache-control", "no-store");
}

/** Null means "refuse here, without contacting Backend". */
export function resolveToolsTargetPath(input: ToolsProxyInput): string | null {
  switch (input.operation) {
    case "trade-card-state":
    case "trade-card-fix":
      return "/api/tools/trade-cards";
    case "trade-card-change":
      if (!CARD_ID_RE.test(input.cardId)) return null;
      return `/api/tools/trade-cards/${encodeURIComponent(input.cardId)}`;
    default:
      return null;
  }
}

export async function proxyTools(request: Request, input: ToolsProxyInput): Promise<Response> {
  const method = methodFor(input.operation);
  const write = method !== "GET";

  if (request.method !== method) {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 405 }), 405);
  }
  // The Backend refuses any query parameter; refusing it here too keeps the
  // forwarded URL a constant.
  if (new URL(request.url).search !== "") {
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

  const path = resolveToolsTargetPath(input);
  if (path === null) {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 400 }), 400);
  }

  let body: BodyInit | undefined;
  if (write) {
    const raw = await request.arrayBuffer();
    if (raw.byteLength > MAX_TOOLS_BODY_BYTES) {
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
  if (out.byteLength > MAX_TOOLS_RESPONSE_BYTES) {
    return errorResponse(makeError("BACKEND_UNAVAILABLE"), 502);
  }

  const headers = new Headers();
  copyResponseHeaders(backendResponse.headers, headers);
  return new Response(out, { status: backendResponse.status, headers });
}
