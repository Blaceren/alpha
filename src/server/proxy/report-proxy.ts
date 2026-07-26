/**
 * Bounded same-origin proxy for the Curriculum V2 learner REPORT routes
 * (SERVER-ONLY). Like `assessment-proxy.ts` / `curriculum-proxy.ts` this is NOT
 * an arbitrary forwarder: it exposes exactly the six learner report operations,
 * each pinned to one HTTP method and one constant Backend path shape. The only
 * caller-controlled inputs are a validated `stableCode` path segment, a validated
 * positive-integer `revisionId`, and validated `locale`/`limit`/`cursor` query
 * values; the request body and the CSRF / Idempotency-Key headers are forwarded
 * on writes, nothing else.
 *
 *   report-definition  GET  /api/curriculum/v2/levels/{stableCode}/report?locale=
 *   report-draft       PUT  /api/curriculum/v2/levels/{stableCode}/report/draft
 *   report-submit      POST /api/curriculum/v2/levels/{stableCode}/report/submit
 *   report-resubmit    POST /api/curriculum/v2/levels/{stableCode}/report/resubmit
 *   report-revisions   GET  /api/curriculum/v2/levels/{stableCode}/report/revisions?locale=&limit=&cursor=
 *   report-revision    GET  /api/curriculum/v2/levels/{stableCode}/report/revisions/{revisionId}?locale=
 *
 * No host / absolute URL / arbitrary path / attachment route is ever accepted,
 * which is what keeps SSRF structurally impossible. The browser never sees the
 * Backend origin. The attachment routes are deliberately absent from this proxy.
 */
import { getAcademyConfig, AcademyConfigError } from "@/config/academy-config";
import { makeError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

export type ReportProxyInput =
  | { operation: "report-definition"; stableCode: string; locale: string | null }
  | { operation: "report-draft"; stableCode: string }
  | { operation: "report-submit"; stableCode: string }
  | { operation: "report-resubmit"; stableCode: string }
  | { operation: "report-revisions"; stableCode: string; locale: string | null; limit: string | null; cursor: string | null }
  | { operation: "report-revision"; stableCode: string; revisionId: string; locale: string | null };

/** stableCode: conservative identity charset, bounded length (matches Backend). */
const STABLE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** locale: short BCP-47-ish token. */
const LOCALE_RE = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})?$/;
/** history paging bounds mirror the Backend `historyQuery` schema. */
const LIMIT_RE = /^[1-9][0-9]?$|^50$/; // 1..50, no leading zero
const CURSOR_RE = /^[1-9][0-9]{0,9}$/;

/** 64 KiB is far more than any 43-field report submission needs. */
export const MAX_REPORT_BODY_BYTES = 64 * 1024;
/** The definition + submission payload for 43 fields is comfortably < 512 KiB. */
export const MAX_REPORT_RESPONSE_BYTES = 512 * 1024;

const READ_REQUEST_HEADERS = new Set(["cookie", "accept", REQUEST_ID_HEADER]);
const WRITE_REQUEST_HEADERS = new Set([
  "content-type",
  "cookie",
  "x-csrf-token",
  "idempotency-key",
  "accept",
  REQUEST_ID_HEADER,
]);
const FORWARD_RESPONSE_HEADERS = new Set([
  "content-type",
  "cache-control",
  REQUEST_ID_HEADER,
]);

type Method = "GET" | "PUT" | "POST";

function methodFor(operation: ReportProxyInput["operation"]): Method {
  if (operation === "report-draft") return "PUT";
  if (operation === "report-submit" || operation === "report-resubmit") return "POST";
  return "GET";
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
  // A learner report response is never cacheable unless Backend says so.
  if (!to.has("cache-control")) to.set("cache-control", "no-store");
}

function base(stableCode: string): string | null {
  if (!STABLE_CODE_RE.test(stableCode)) return null;
  return `/api/curriculum/v2/levels/${encodeURIComponent(stableCode)}/report`;
}

function localeQuery(locale: string | null): string | null {
  if (locale === null || !LOCALE_RE.test(locale)) return null;
  return `locale=${encodeURIComponent(locale)}`;
}

export function resolveReportTargetPath(input: ReportProxyInput): string | null {
  const root = base(input.stableCode);
  if (root === null) return null;

  switch (input.operation) {
    case "report-definition": {
      const q = localeQuery(input.locale);
      return q === null ? null : `${root}?${q}`;
    }
    case "report-draft":
      return `${root}/draft`;
    case "report-submit":
      return `${root}/submit`;
    case "report-resubmit":
      return `${root}/resubmit`;
    case "report-revisions": {
      const q = localeQuery(input.locale);
      if (q === null) return null;
      const parts = [q];
      if (input.limit !== null) {
        if (!LIMIT_RE.test(input.limit)) return null;
        parts.push(`limit=${encodeURIComponent(input.limit)}`);
      }
      if (input.cursor !== null) {
        if (!CURSOR_RE.test(input.cursor)) return null;
        parts.push(`cursor=${encodeURIComponent(input.cursor)}`);
      }
      return `${root}/revisions?${parts.join("&")}`;
    }
    case "report-revision": {
      const q = localeQuery(input.locale);
      if (q === null) return null;
      const id = Number(input.revisionId);
      if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== input.revisionId.trim()) return null;
      return `${root}/revisions/${id}?${q}`;
    }
    default:
      return null;
  }
}

export async function proxyReport(request: Request, input: ReportProxyInput): Promise<Response> {
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

  const path = resolveReportTargetPath(input);
  if (path === null) {
    // Bounded rejection WITHOUT contacting Backend (invalid code/locale/id/paging).
    return errorResponse(makeError("VALIDATION_ERROR", { status: 400 }), 400);
  }

  let body: BodyInit | undefined;
  if (write) {
    const raw = await request.arrayBuffer();
    if (raw.byteLength > MAX_REPORT_BODY_BYTES) {
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
  if (out.byteLength > MAX_REPORT_RESPONSE_BYTES) {
    return errorResponse(makeError("MALFORMED_RESPONSE", { status: backendResponse.status }), 502);
  }

  const outHeaders = new Headers();
  copyResponseHeaders(backendResponse.headers, outHeaders);
  return new Response(out, { status: backendResponse.status, headers: outHeaders });
}
