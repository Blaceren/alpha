/**
 * The Academy learner REPORT client (browser).
 *
 * Component code never calls `fetch` directly — it calls these functions. All
 * calls target the Academy same-origin proxy (`/api/backend/*`), so the httpOnly
 * session cookie is sent by the browser and no token is handled in JS. Writes are
 * CSRF-protected (double-submit) via a bootstrapped token, exactly like
 * `logout()` in `src/lib/api/client.ts` and the assessment client. Each mutation
 * carries a caller-supplied stable `Idempotency-Key` so a double click cannot
 * create two revisions or submit twice.
 *
 * Draft/submit/approval are server-authoritative: this client sends stable field
 * codes + a CAS `expectedRevision`, and reads back the Backend's canonical state.
 * It never computes completion, never writes L3 completion, and never awards XP.
 */
import {
  makeError,
  normalizeHttpError,
  REQUEST_ID_HEADER,
  type NormalizedError,
} from "@/lib/api/errors";
import { isBackendCsrfResponse } from "@/lib/api/types";
import {
  isReportCommandResult,
  isReportContext,
  reportCommandData,
  reportContextData,
  type ReportCommandResult,
  type ReportContext,
} from "@/lib/report/types";

const PROXY_BASE = "/api/backend";
const MAX_RESPONSE_BYTES = 512 * 1024;

export type ReportApiResult<T> =
  | { ok: true; data: T; requestId: string | null }
  | { ok: false; error: NormalizedError };

async function readBoundedJson(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return { ok: false };
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Session-scoped CSRF token cache. The Backend double-submit token is stable for
 * the session, so we bootstrap it once and reuse it across writes instead of
 * re-fetching before every write. This bounds request bursts (e.g. a save-then-
 * submit or a rapid double click) without weakening CSRF — a rejected write still
 * surfaces as an error and the next action re-bootstraps.
 */
let cachedCsrf: string | null = null;

/** Test-only: clear the session CSRF cache between cases. */
export function __resetReportCsrfCacheForTests(): void {
  cachedCsrf = null;
}

async function getCsrfToken(signal?: AbortSignal): Promise<ReportApiResult<string>> {
  if (cachedCsrf) return { ok: true, data: cachedCsrf, requestId: null };
  // The CSRF bootstrap is an idempotent GET with no side effects, so a single
  // bounded retry is safe and smooths a transient backend hiccup. (Report WRITES
  // are never auto-retried — a retried write could create a second revision.)
  let result = await fetchCsrfToken(signal);
  if (!result.ok && !signal?.aborted) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    result = await fetchCsrfToken(signal);
  }
  if (result.ok) cachedCsrf = result.data;
  return result;
}

/** Bootstrap a CSRF token from the Backend (same pattern as logout / assessment). */
async function fetchCsrfToken(signal?: AbortSignal): Promise<ReportApiResult<string>> {
  let response: Response;
  try {
    response = await fetch(`${PROXY_BASE}/csrf`, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR") };
  }
  const requestId = response.headers.get(REQUEST_ID_HEADER);
  if (!response.ok) {
    const parsed = await readBoundedJson(response);
    return { ok: false, error: normalizeHttpError({ status: response.status, body: parsed.ok ? parsed.value : undefined, requestId }) };
  }
  const parsed = await readBoundedJson(response);
  if (!parsed.ok || !isBackendCsrfResponse(parsed.value)) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE", { status: response.status, requestId }) };
  }
  return { ok: true, data: parsed.value.csrfToken, requestId };
}

async function get<T>(
  path: string,
  validate: (value: unknown) => value is T,
  signal?: AbortSignal,
): Promise<ReportApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR") };
  }
  const requestId = response.headers.get(REQUEST_ID_HEADER);
  if (!response.ok) {
    const parsed = await readBoundedJson(response);
    return { ok: false, error: normalizeHttpError({ status: response.status, body: parsed.ok ? parsed.value : undefined, requestId }) };
  }
  const parsed = await readBoundedJson(response);
  if (!parsed.ok || !validate(parsed.value)) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE", { status: response.status, requestId }) };
  }
  return { ok: true, data: parsed.value as T, requestId };
}

type WriteArgs = {
  method: "PUT" | "POST";
  path: string;
  jsonBody: unknown;
  csrfToken: string;
  idempotencyKey: string;
  signal?: AbortSignal;
};

async function write<T>(
  args: WriteArgs,
  validate: (value: unknown) => value is T,
): Promise<ReportApiResult<T>> {
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
    "x-csrf-token": args.csrfToken,
    "idempotency-key": args.idempotencyKey,
  });

  let response: Response;
  try {
    response = await fetch(args.path, {
      method: args.method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(args.jsonBody),
      signal: args.signal,
    });
  } catch {
    // No auto-retry: a retried write could create a second revision.
    return { ok: false, error: makeError("NETWORK_ERROR") };
  }

  const requestId = response.headers.get(REQUEST_ID_HEADER);
  if (!response.ok) {
    // A CSRF rejection invalidates the cached token so the next action re-bootstraps.
    if (response.status === 403) cachedCsrf = null;
    const parsed = await readBoundedJson(response);
    return { ok: false, error: normalizeHttpError({ status: response.status, body: parsed.ok ? parsed.value : undefined, requestId }) };
  }
  const parsed = await readBoundedJson(response);
  if (!parsed.ok || !validate(parsed.value)) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE", { status: response.status, requestId }) };
  }
  return { ok: true, data: parsed.value as T, requestId };
}

/**
 * Generate a stable idempotency key for one write action. Matches the Backend
 * pattern /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/. Reuse the SAME key to retry the
 * identical write; create a NEW key for a distinct action.
 */
export function newReportRequestId(prefix = "save"): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `ata-rpt-${prefix}-${uuid}`;
}

/** Read the L3 report definition + current submission state. */
export function fetchReportContext(
  stableCode: string,
  locale: string,
  signal?: AbortSignal,
): Promise<ReportApiResult<ReportContext>> {
  const path = `${PROXY_BASE}/curriculum/levels/${encodeURIComponent(stableCode)}/report?locale=${encodeURIComponent(locale)}`;
  return get(path, isReportContext, signal).then((res) =>
    res.ok ? { ok: true, data: reportContextData(res.data), requestId: res.requestId } : res,
  );
}

/** Save (or create, when `expectedRevision === 0`) the server draft. */
export async function saveReportDraft(
  stableCode: string,
  expectedRevision: number,
  fieldValues: Record<string, unknown>,
  requestId: string,
  signal?: AbortSignal,
): Promise<ReportApiResult<ReportCommandResult>> {
  const csrf = await getCsrfToken(signal);
  if (!csrf.ok) return csrf;
  const result = await write(
    {
      method: "PUT",
      path: `${PROXY_BASE}/curriculum/levels/${encodeURIComponent(stableCode)}/report/draft`,
      jsonBody: { expectedRevision, fieldValues },
      csrfToken: csrf.data,
      idempotencyKey: requestId,
      signal,
    },
    isReportCommandResult,
  );
  return result.ok ? { ok: true, data: reportCommandData(result.data), requestId: result.requestId } : result;
}

/** Submit the current draft for review. */
export async function submitReport(
  stableCode: string,
  expectedRevision: number,
  requestId: string,
  signal?: AbortSignal,
): Promise<ReportApiResult<ReportCommandResult>> {
  const csrf = await getCsrfToken(signal);
  if (!csrf.ok) return csrf;
  const result = await write(
    {
      method: "POST",
      path: `${PROXY_BASE}/curriculum/levels/${encodeURIComponent(stableCode)}/report/submit`,
      jsonBody: { expectedRevision },
      csrfToken: csrf.data,
      idempotencyKey: requestId,
      signal,
    },
    isReportCommandResult,
  );
  return result.ok ? { ok: true, data: reportCommandData(result.data), requestId: result.requestId } : result;
}

/** Resubmit a corrected revision after a revision request. */
export async function resubmitReport(
  stableCode: string,
  expectedRevision: number,
  requestId: string,
  signal?: AbortSignal,
): Promise<ReportApiResult<ReportCommandResult>> {
  const csrf = await getCsrfToken(signal);
  if (!csrf.ok) return csrf;
  const result = await write(
    {
      method: "POST",
      path: `${PROXY_BASE}/curriculum/levels/${encodeURIComponent(stableCode)}/report/resubmit`,
      jsonBody: { expectedRevision },
      csrfToken: csrf.data,
      idempotencyKey: requestId,
      signal,
    },
    isReportCommandResult,
  );
  return result.ok ? { ok: true, data: reportCommandData(result.data), requestId: result.requestId } : result;
}
