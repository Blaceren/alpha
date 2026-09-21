/**
 * Bounded same-origin proxy for the learner's TOOL routes (SERVER-ONLY).
 *
 * Like every other proxy in this directory it is NOT an arbitrary forwarder. It
 * exposes exactly eight learner operations, each pinned to one HTTP method and
 * one constant Backend path shape:
 *
 *   trade-card-state    GET   /api/tools/trade-cards
 *   trade-card-fix      POST  /api/tools/trade-cards
 *   trade-card-change   PATCH /api/tools/trade-cards/{cardId}
 *   journal-page        GET   /api/tools/journal?filter=…&before=…
 *   journal-create      POST  /api/tools/journal
 *   journal-change      PATCH /api/tools/journal/{entryId}
 *   risk-state          GET   /api/tools/risk-plan
 *   risk-save           POST  /api/tools/risk-plan
 *
 * THE ONLY CALLER-CONTROLLED INPUT IS A VALIDATED ID, and for a journal page a
 * filter from a closed list. No host, no absolute URL, no arbitrary path, and
 * no query parameter other than those two on that one operation — rebuilt from
 * the validated values, never passed through — which keeps SSRF structurally
 * impossible. The browser never sees the Backend origin.
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
  | { operation: "trade-card-change"; cardId: string }
  | { operation: "journal-page" }
  | { operation: "journal-create" }
  | { operation: "journal-change"; entryId: string }
  | { operation: "risk-state" }
  | { operation: "risk-save" };

/** A cuid, and nothing that could leave the path segment it belongs to. */
const CARD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const JOURNAL_FILTERS = new Set(["all", "violated", "no_conclusion"]);

/**
 * The largest write is a hand-recorded journal entry: short fields and three
 * texts of at most 1 000, 2 000 and 2 000 characters. At three UTF-8 bytes a
 * character that is 15 KB; 32 KB leaves room for JSON escapes.
 */
export const MAX_TOOLS_BODY_BYTES = 32 * 1024;
/** The card, or the card plus the two reference lists. */
export const MAX_TOOLS_RESPONSE_BYTES = 128 * 1024;
/** A journal page: twenty entries whose texts may each be at their longest. */
export const MAX_JOURNAL_RESPONSE_BYTES = 768 * 1024;

const READ_REQUEST_HEADERS = new Set(["cookie", "accept", REQUEST_ID_HEADER]);
const WRITE_REQUEST_HEADERS = new Set(["content-type", "cookie", "x-csrf-token", "accept", REQUEST_ID_HEADER]);
/* Cache-Control is NOT copied: a learner's tool data is private, so every
   answer is `no-store` whatever the Backend said. */
const FORWARD_RESPONSE_HEADERS = new Set(["content-type", REQUEST_ID_HEADER]);

type Method = "GET" | "POST" | "PATCH";

function methodFor(operation: ToolsProxyInput["operation"]): Method {
  switch (operation) {
    case "trade-card-state":
    case "journal-page":
    case "risk-state":
      return "GET";
    case "trade-card-fix":
    case "journal-create":
    case "risk-save":
      return "POST";
    case "trade-card-change":
    case "journal-change":
      return "PATCH";
  }
}

/**
 * The only query string any operation forwards: a journal page's filter and
 * cursor, validated and rebuilt. Null means "refuse"; "" means "none".
 */
export function resolveToolsQuery(input: ToolsProxyInput, search: URLSearchParams): string | null {
  if (input.operation !== "journal-page") return [...search.keys()].length === 0 ? "" : null;
  const out = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key === "filter" && JOURNAL_FILTERS.has(value) && !out.has("filter")) out.set("filter", value);
    else if (key === "before" && CARD_ID_RE.test(value) && !out.has("before")) out.set("before", value);
    else return null;
  }
  const query = out.toString();
  return query.length > 0 ? `?${query}` : "";
}

function errorResponse(error: NormalizedError, status: number): Response {
  return new Response(JSON.stringify(error), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
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
    case "journal-page":
    case "journal-create":
      return "/api/tools/journal";
    case "journal-change":
      if (!CARD_ID_RE.test(input.entryId)) return null;
      return `/api/tools/journal/${encodeURIComponent(input.entryId)}`;
    case "risk-state":
    case "risk-save":
      return "/api/tools/risk-plan";
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
  // Only a journal page carries a query, rebuilt from validated values; every
  // other operation refuses one, which keeps its forwarded URL a constant.
  const query = resolveToolsQuery(input, new URL(request.url).searchParams);
  if (query === null) {
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
    backendResponse = await fetch(`${config.backendOrigin}${path}${query}`, {
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
    return errorResponse(
      makeError(aborted ? "NETWORK_ERROR" : "BACKEND_UNAVAILABLE", {
        requestId,
      }),
      502,
    );
  } finally {
    clearTimeout(timeout);
  }

  const out = await backendResponse.arrayBuffer();
  const cap = input.operation === "journal-page" ? MAX_JOURNAL_RESPONSE_BYTES : MAX_TOOLS_RESPONSE_BYTES;
  if (out.byteLength > cap) {
    return errorResponse(makeError("BACKEND_UNAVAILABLE"), 502);
  }

  const headers = new Headers();
  copyResponseHeaders(backendResponse.headers, headers);
  return new Response(out, { status: backendResponse.status, headers });
}
