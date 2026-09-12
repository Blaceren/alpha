/**
 * The Academy learner CHECKPOINT client (browser).
 *
 * Component code never calls `fetch` directly. Every call targets the Academy
 * same-origin proxy (`/api/backend/*`), so the httpOnly session cookie is sent
 * by the browser and no token is handled in JS. The write is CSRF-protected
 * (double-submit) via a bootstrapped token, exactly like the assessment client.
 *
 * THE REQUEST BODY IS ONE FIELD. `{ requestId }` and nothing else: no balance,
 * no currency, no account, no login, no deposit. There is no parameter through
 * which this client could send the learner's money, because it has none.
 *
 * NO AUTOMATIC RETRY. A retried POST with a fresh identity would spend the
 * learner's hourly allowance without them asking. A retry of the SAME action
 * reuses the SAME requestId, which the Backend replays.
 */
import {
  makeError,
  normalizeHttpError,
  REQUEST_ID_HEADER,
  type NormalizedError,
} from "@/lib/api/errors";
import { isBackendCsrfResponse } from "@/lib/api/types";
import {
  checkpointVerificationData,
  isCheckpointVerificationEnvelope,
  type CheckpointVerificationResult,
} from "@/lib/checkpoint/types";

const PROXY_BASE = "/api/backend";
const MAX_RESPONSE_BYTES = 64 * 1024;

export type CheckpointApiResult<T> =
  | { ok: true; data: T; requestId: string | null }
  | { ok: false; error: NormalizedError };

async function readBoundedJson(
  response: Response,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
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

async function fetchCsrfToken(signal?: AbortSignal): Promise<CheckpointApiResult<string>> {
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
  const parsed = await readBoundedJson(response);
  if (!response.ok) {
    return {
      ok: false,
      error: normalizeHttpError({
        status: response.status,
        body: parsed.ok ? parsed.value : undefined,
        requestId,
      }),
    };
  }
  if (!parsed.ok || !isBackendCsrfResponse(parsed.value)) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE", { status: response.status, requestId }) };
  }
  return { ok: true, data: parsed.value.csrfToken, requestId };
}

/**
 * Generate a stable identity for ONE verification attempt.
 *
 * Matches the Backend pattern /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/. A new key
 * per distinct attempt; the SAME key for a retry of the identical attempt, so a
 * double click or a lost response replays rather than re-asks.
 */
export function newCheckpointRequestId(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `ata-cp-${uuid}`;
}

/** Ask the Backend to verify the learner's current financial checkpoint. */
export async function verifyCheckpoint(
  stableCode: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<CheckpointApiResult<CheckpointVerificationResult>> {
  const csrf = await fetchCsrfToken(signal);
  if (!csrf.ok) return csrf;

  let response: Response;
  try {
    response = await fetch(
      `${PROXY_BASE}/curriculum/levels/${encodeURIComponent(stableCode)}/checkpoint/verify`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-csrf-token": csrf.data,
        },
        credentials: "same-origin",
        cache: "no-store",
        // The complete request. One field.
        body: JSON.stringify({ requestId }),
        signal,
      },
    );
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR") };
  }

  const backendRequestId = response.headers.get(REQUEST_ID_HEADER);
  const parsed = await readBoundedJson(response);
  if (!response.ok) {
    return {
      ok: false,
      error: normalizeHttpError({
        status: response.status,
        body: parsed.ok ? parsed.value : undefined,
        requestId: backendRequestId,
      }),
    };
  }
  if (!parsed.ok || !isCheckpointVerificationEnvelope(parsed.value)) {
    return {
      ok: false,
      error: makeError("MALFORMED_RESPONSE", { status: response.status, requestId: backendRequestId }),
    };
  }
  return {
    ok: true,
    data: checkpointVerificationData(parsed.value),
    requestId: backendRequestId,
  };
}
