/**
 * The Academy learner ASSESSMENT client (browser).
 *
 * Component code never calls `fetch` directly — it calls these functions. All
 * calls target the Academy same-origin proxy (`/api/backend/*`), so the httpOnly
 * session cookie is sent by the browser and no token is handled in JS. Writes are
 * CSRF-protected (double-submit) via a bootstrapped token, exactly like
 * `logout()` in `src/lib/api/client.ts`. The submit carries a caller-supplied
 * stable `Idempotency-Key` so a double click cannot create two attempts.
 *
 * Grading and completion are server-authoritative: this client sends only stable
 * question/option identifiers and reads back the Backend's canonical result. It
 * never computes a score, never decides pass/fail, and never writes completion.
 */
import {
  makeError,
  normalizeHttpError,
  REQUEST_ID_HEADER,
  type NormalizedError,
} from "@/lib/api/errors";
import { isBackendCsrfResponse } from "@/lib/api/types";
import {
  assessmentResultData,
  assessmentStartData,
  isAssessmentResult,
  isAssessmentStart,
  type AssessmentAnswer,
  type AssessmentResult,
  type AssessmentStart,
} from "@/lib/assessment/types";

const PROXY_BASE = "/api/backend";
const MAX_RESPONSE_BYTES = 256 * 1024;

export type AssessmentApiResult<T> =
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

/** Bootstrap a CSRF token from the Backend (same pattern as logout). */
async function fetchCsrfToken(signal?: AbortSignal): Promise<AssessmentApiResult<string>> {
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

type PostArgs = {
  path: string;
  jsonBody: unknown;
  csrfToken: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
};

async function post<T>(
  args: PostArgs,
  validate: (value: unknown) => value is T,
): Promise<AssessmentApiResult<T>> {
  const headers = new Headers({ accept: "application/json", "content-type": "application/json", "x-csrf-token": args.csrfToken });
  if (args.idempotencyKey) headers.set("idempotency-key", args.idempotencyKey);

  let response: Response;
  try {
    response = await fetch(args.path, {
      method: "POST",
      headers,
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(args.jsonBody),
      signal: args.signal,
    });
  } catch {
    // No auto-retry: a retried POST could create a second attempt.
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

/**
 * Generate a stable idempotency key for one submit action. Matches the Backend
 * pattern /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/. A NEW key must be created per
 * distinct attempt; reuse the SAME key for a retry of the identical submission.
 */
export function newRequestId(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `ata-asmt-${uuid}`;
}

/** Start (or resume) the L2 assessment attempt; returns answer-free questions. */
export async function startAssessment(
  stableCode: string,
  locale: string,
  signal?: AbortSignal,
): Promise<AssessmentApiResult<AssessmentStart>> {
  const csrf = await fetchCsrfToken(signal);
  if (!csrf.ok) return csrf;
  const result = await post(
    {
      path: `${PROXY_BASE}/curriculum/levels/${encodeURIComponent(stableCode)}/assessment/attempts`,
      jsonBody: { locale },
      csrfToken: csrf.data,
      signal,
    },
    isAssessmentStart,
  );
  if (!result.ok) return result;
  return { ok: true, data: assessmentStartData(result.data), requestId: result.requestId };
}

/** Submit graded answers for an attempt. `requestId` is the idempotency key. */
export async function submitAssessment(
  attemptId: number,
  answers: AssessmentAnswer[],
  requestId: string,
  signal?: AbortSignal,
): Promise<AssessmentApiResult<AssessmentResult>> {
  const csrf = await fetchCsrfToken(signal);
  if (!csrf.ok) return csrf;
  const result = await post(
    {
      path: `${PROXY_BASE}/curriculum/assessment/attempts/${attemptId}/submit`,
      jsonBody: { answers },
      csrfToken: csrf.data,
      idempotencyKey: requestId,
      signal,
    },
    isAssessmentResult,
  );
  if (!result.ok) return result;
  return { ok: true, data: assessmentResultData(result.data), requestId: result.requestId };
}
