/**
 * The Academy learner LESSON READING PROGRESS client (browser).
 *
 * WHAT IT SAVES. Which sections of the written lesson the learner has marked
 * read, and which section they are on. That is all — there is no field on this
 * request that names a level state, a completion, XP, a score or a verdict,
 * because the Backend command behind it writes `UserLessonProgress` and nothing
 * else, and refuses entirely unless the level is already `in_progress`.
 *
 * WHY IT REPLACES A BROWSER STORE. The fixture-era lesson kept this in
 * sessionStorage, which made the browser the authority on how far a learner had
 * read — a fact that then vanished on another device and could not be trusted
 * by anything server-side. This is the same fact, owned by the server.
 *
 * CONCURRENCY IS THE BACKEND'S. Every save carries the `expectedRevision` the
 * last read returned. A stale value is REFUSED upstream rather than merged here;
 * this client has no conflict-resolution logic and must never grow any, because
 * resolving a conflict locally means deciding what the learner has read.
 *
 * FAILURE IS SILENT AND SAFE. A save that does not land leaves the reading
 * position as it was. Nothing about the lesson becomes unreadable, and nothing
 * the learner can see claims a state the server did not accept.
 */
import {
  makeError,
  normalizeHttpError,
  REQUEST_ID_HEADER,
  type NormalizedError,
} from "@/lib/api/errors";
import { isBackendCsrfResponse } from "@/lib/api/types";

const PROXY_BASE = "/api/backend";
const MAX_RESPONSE_BYTES = 64 * 1024;

/** The Backend's accepted reading position, echoed back. */
export type LessonProgressSaved = {
  /** The revision to send with the NEXT save. */
  acceptedRevision: number;
  completedSections: readonly string[];
  activeSectionCode: string | null;
};

export type LessonProgressResult =
  | { ok: true; data: LessonProgressSaved }
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

async function fetchCsrfToken(
  signal?: AbortSignal,
): Promise<{ ok: true; token: string } | { ok: false; error: NormalizedError }> {
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
      error: normalizeHttpError({ status: response.status, body: parsed.ok ? parsed.value : undefined, requestId }),
    };
  }
  if (!parsed.ok || !isBackendCsrfResponse(parsed.value)) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE", { status: response.status, requestId }) };
  }
  return { ok: true, token: parsed.value.csrfToken };
}

/** A stable identity for one save. Matches the Backend's request-id pattern. */
export function newLessonProgressRequestId(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `ata-lp-${uuid}`;
}

function isEnvelope(value: unknown): value is {
  data: { acceptedRevision: number; progress: { completedSections: unknown; progressData: unknown } };
} {
  if (typeof value !== "object" || value === null) return false;
  const data = (value as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  return typeof record.acceptedRevision === "number" && typeof record.progress === "object" && record.progress !== null;
}

/**
 * Save the learner's reading position.
 *
 * `playbackPositionSeconds` is required by the canonical command and is passed
 * through unchanged from whatever the last read returned. The reader does not
 * currently move it — the published curriculum carries no video assets — and it
 * is deliberately not defaulted to 0, which would silently discard a position a
 * future player had saved.
 */
export async function saveLessonReadingProgress(
  stableCode: string,
  input: {
    expectedRevision: number;
    completedSections: readonly string[];
    activeSectionCode: string | null;
    playbackPositionSeconds: number;
  },
  requestId: string,
  signal?: AbortSignal,
): Promise<LessonProgressResult> {
  const csrf = await fetchCsrfToken(signal);
  if (!csrf.ok) return { ok: false, error: csrf.error };

  let response: Response;
  try {
    response = await fetch(
      `${PROXY_BASE}/curriculum/levels/${encodeURIComponent(stableCode)}/lesson-progress`,
      {
        method: "PATCH",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-csrf-token": csrf.token,
          "idempotency-key": requestId,
        },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          expectedRevision: input.expectedRevision,
          playbackPositionSeconds: input.playbackPositionSeconds,
          completedSections: [...input.completedSections],
          progressData: { activeSectionCode: input.activeSectionCode },
        }),
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
  if (!parsed.ok || !isEnvelope(parsed.value)) {
    return {
      ok: false,
      error: makeError("MALFORMED_RESPONSE", { status: response.status, requestId: backendRequestId }),
    };
  }

  const progress = parsed.value.data.progress as Record<string, unknown>;
  const completedSections = Array.isArray(progress.completedSections)
    ? progress.completedSections.filter((code): code is string => typeof code === "string")
    : [];
  const progressData =
    typeof progress.progressData === "object" && progress.progressData !== null
      ? (progress.progressData as Record<string, unknown>)
      : null;

  return {
    ok: true,
    data: {
      acceptedRevision: parsed.value.data.acceptedRevision,
      completedSections,
      activeSectionCode:
        typeof progressData?.activeSectionCode === "string" ? progressData.activeSectionCode : null,
    },
  };
}
