/**
 * The shared transport of the learner's tool clients.
 *
 * Every tool talks to the Backend the same way: relative paths through the
 * `/api/backend` same-origin proxy, a CSRF token fetched per mutation, a bounded
 * JSON read, and a NORMALIZED error rather than a thrown exception. The tools
 * differ only in their paths and in the shapes they guard.
 *
 * ONE ADDITION to the shared normalizer: the Backend names a refused field in
 * `detail` (`invalid_amount` …), which the normalizer drops. The tools read it
 * here, so a form can put the message under the right field.
 */
import { makeError, normalizeHttpError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

export const PROXY_BASE = "/api/backend";
const MAX_RESPONSE_BYTES = 768 * 1024;

export type ToolFailure = { ok: false; error: NormalizedError; detail: string | null };
export type ToolResult<T> = { ok: true; data: T } | ToolFailure;

async function readBoundedJson(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    const raw = await response.arrayBuffer();
    if (raw.byteLength > MAX_RESPONSE_BYTES) return { ok: false };
    if (raw.byteLength === 0) return { ok: true, value: undefined };
    return { ok: true, value: JSON.parse(new TextDecoder().decode(raw)) as unknown };
  } catch {
    return { ok: false };
  }
}

function detailOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const detail = (body as { detail?: unknown }).detail;
  return typeof detail === "string" && /^[a-z][a-zA-Z_]{0,63}$/.test(detail) ? detail : null;
}

async function readEnvelope<T>(response: Response, guard: (value: unknown) => value is T): Promise<ToolResult<T>> {
  const requestId = response.headers.get(REQUEST_ID_HEADER);
  const parsed = await readBoundedJson(response);
  if (!response.ok) {
    const body = parsed.ok ? parsed.value : undefined;
    return {
      ok: false,
      error: normalizeHttpError({ status: response.status, body, requestId }),
      detail: detailOf(body),
    };
  }
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE", { requestId }), detail: null };
  }
  const data = (parsed.value as { data?: unknown }).data;
  if (!guard(data)) return { ok: false, error: makeError("MALFORMED_RESPONSE", { requestId }), detail: null };
  return { ok: true, data };
}

async function fetchCsrfToken(): Promise<{ ok: true; token: string } | ToolFailure> {
  let response: Response;
  try {
    response = await fetch(`${PROXY_BASE}/csrf`, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR"), detail: null };
  }
  const requestId = response.headers.get(REQUEST_ID_HEADER);
  const parsed = await readBoundedJson(response);
  if (!response.ok) {
    return {
      ok: false,
      error: normalizeHttpError({ status: response.status, body: parsed.ok ? parsed.value : undefined, requestId }),
      detail: null,
    };
  }
  const token =
    parsed.ok && typeof parsed.value === "object" && parsed.value !== null
      ? (parsed.value as { csrfToken?: unknown }).csrfToken
      : undefined;
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE"), detail: null };
  }
  return { ok: true, token };
}

/** A read. No token, no body. */
export async function toolGet<T>(path: string, guard: (value: unknown) => value is T): Promise<ToolResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR"), detail: null };
  }
  return readEnvelope(response, guard);
}

/** A write, with a fresh CSRF token. */
export async function toolSend<T>(
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
  guard: (value: unknown) => value is T,
): Promise<ToolResult<T>> {
  const csrf = await fetchCsrfToken();
  if (!csrf.ok) return csrf;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { accept: "application/json", "content-type": "application/json", "x-csrf-token": csrf.token },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR"), detail: null };
  }
  return readEnvelope(response, guard);
}

/* ------------------------------------------------------------ small guards */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
