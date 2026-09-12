/**
 * The Academy learner MANUAL COMPLETION client (browser).
 *
 * Component code never calls `fetch` directly. This targets the Academy
 * same-origin proxy (`/api/backend/*`), so the httpOnly session cookie is sent
 * by the browser and no token is handled in JS. The write is CSRF-protected
 * (double-submit) via a bootstrapped token, exactly like the checkpoint and
 * level-start clients.
 *
 * THE REQUEST BODY IS ONE FIELD. `{ requestId }` and nothing else: no learner,
 * no enrollment, no level id, no XP amount, no status, no completion time and no
 * evidence blob. There is no parameter through which this client could complete
 * a level for someone else, award itself XP or backdate anything — the Backend
 * takes the actor from the session and the level from the path.
 *
 * NO AUTOMATIC RETRY, AND A STABLE IDENTITY PER ACTION. The request id is
 * generated once per distinct completion attempt and REUSED for a retry of that
 * same attempt, so a double click or a lost response replays idempotently in the
 * Backend rather than producing a second completion. A retry with a fresh
 * identity against an already-completed XP-bearing level is a conflict by
 * design, which is why one is never generated silently.
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

/**
 * The Backend's completion receipt, as the Academy is allowed to see it.
 *
 * Note what is absent: no user, no enrollment id, no progress row, no audit
 * identifier. `xpAwarded` is the canonical reward the curriculum published for
 * this level, echoed back so the learner can be told what they earned — it is
 * never an input.
 */
export type ManualCompletionResult = {
  /** False on an idempotent replay of the same request identity. */
  created: boolean;
  levelNumber: number;
  stableCode: string;
  completionMethod: string;
  xpAwarded: number;
  nextLevelNumber: number | null;
  terminal: boolean;
  completedAt: string;
};

export type ManualCompletionApiResult =
  | { ok: true; data: ManualCompletionResult; requestId: string | null }
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

/**
 * Generate a stable identity for ONE completion attempt.
 *
 * Matches the Backend pattern /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/.
 */
export function newManualCompletionRequestId(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `ata-mc-${uuid}`;
}

function isManualCompletionEnvelope(value: unknown): value is { data: ManualCompletionResult } {
  if (typeof value !== "object" || value === null) return false;
  const data = (value as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    typeof record.created === "boolean" &&
    typeof record.levelNumber === "number" &&
    typeof record.stableCode === "string" &&
    typeof record.completionMethod === "string" &&
    typeof record.xpAwarded === "number" &&
    (record.nextLevelNumber === null || typeof record.nextLevelNumber === "number") &&
    typeof record.terminal === "boolean" &&
    typeof record.completedAt === "string"
  );
}

/** Ask the Backend to complete the learner's current manual level. */
export async function completeManualLevel(
  stableCode: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<ManualCompletionApiResult> {
  const csrf = await fetchCsrfToken(signal);
  if (!csrf.ok) return { ok: false, error: csrf.error };

  let response: Response;
  try {
    response = await fetch(
      `${PROXY_BASE}/curriculum/levels/${encodeURIComponent(stableCode)}/complete`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-csrf-token": csrf.token,
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
  if (!parsed.ok || !isManualCompletionEnvelope(parsed.value)) {
    return {
      ok: false,
      error: makeError("MALFORMED_RESPONSE", { status: response.status, requestId: backendRequestId }),
    };
  }
  return { ok: true, data: parsed.value.data, requestId: backendRequestId };
}
