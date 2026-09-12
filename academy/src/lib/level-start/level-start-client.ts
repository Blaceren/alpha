/**
 * The Academy learner LEVEL START client (browser).
 *
 * Component code never calls `fetch` directly. This targets the Academy
 * same-origin proxy (`/api/backend/*`), so the httpOnly session cookie is sent
 * by the browser and no token is handled in JS. The write is CSRF-protected
 * (double-submit) via a bootstrapped token, exactly like the checkpoint client.
 *
 * THE REQUEST HAS NO BODY. Starting a level takes no learner input at all: the
 * Backend derives the actor from the session and starts that learner's current
 * level. The stable code travels in the path purely so the Backend can refuse
 * when this page is stale about which level is current.
 *
 * NO AUTOMATIC RETRY. The Backend start is idempotent, so a retry would be
 * harmless — but retrying silently would turn a real outage into an apparent
 * success, and the learner would be left looking at a level that never started.
 * A failure is surfaced and the learner decides.
 */
import {
  makeError,
  normalizeHttpError,
  REQUEST_ID_HEADER,
  type NormalizedError,
} from "@/lib/api/errors";
import { isBackendCsrfResponse } from "@/lib/api/types";

const PROXY_BASE = "/api/backend";
const MAX_RESPONSE_BYTES = 16 * 1024;

/** What the Backend tells us about the level it started. */
export type LevelStartResult = {
  state: string;
  stableCode: string;
  levelNumber: number;
  /** False on an idempotent repeat — the level was already in progress. */
  created: boolean;
};

export type LevelStartApiResult =
  | { ok: true; data: LevelStartResult; requestId: string | null }
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

async function fetchCsrfToken(signal?: AbortSignal): Promise<
  { ok: true; token: string } | { ok: false; error: NormalizedError }
> {
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
  return { ok: true, token: parsed.value.csrfToken };
}

function isLevelStartEnvelope(value: unknown): value is { data: LevelStartResult } {
  if (typeof value !== "object" || value === null) return false;
  const data = (value as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    typeof record.state === "string" &&
    typeof record.stableCode === "string" &&
    typeof record.levelNumber === "number" &&
    typeof record.created === "boolean"
  );
}

/** Ask the Backend to start the learner's current level. */
export async function startLevel(
  stableCode: string,
  signal?: AbortSignal,
): Promise<LevelStartApiResult> {
  const csrf = await fetchCsrfToken(signal);
  if (!csrf.ok) return { ok: false, error: csrf.error };

  let response: Response;
  try {
    response = await fetch(
      `${PROXY_BASE}/curriculum/levels/${encodeURIComponent(stableCode)}/start`,
      {
        method: "POST",
        headers: { accept: "application/json", "x-csrf-token": csrf.token },
        credentials: "same-origin",
        cache: "no-store",
        signal,
      },
    );
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
  if (!parsed.ok || !isLevelStartEnvelope(parsed.value)) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE", { status: response.status, requestId }) };
  }
  return { ok: true, data: parsed.value.data, requestId };
}
