/**
 * Bounded same-origin proxy for the Curriculum V2 LESSON PROGRESS route
 * (SERVER-ONLY).
 *
 * One operation, one pinned Backend path shape, exactly like every other
 * learner proxy here:
 *
 *   lesson-progress -> PATCH /api/curriculum/v2/levels/{stableCode}/lesson-progress
 *
 * WHAT THIS WRITES, AND WHY IT IS NOT PROGRESSION.
 * `UserLessonProgress` is a READING POSITION: which sections of the text the
 * learner has marked read, where the video was left, which section is active.
 * It is a different row from `UserLevelProgress` with a different owner, and the
 * Backend's save path never touches the progression row — it refuses outright
 * unless the level is ALREADY `in_progress`, and refuses again the moment the
 * level completes. So nothing that travels through this proxy can finish a
 * level, unlock the next one, award XP or change a review verdict.
 *
 * That is the whole reason it exists. The fixture-era lesson kept its progress
 * in the browser's own storage, which made the client the authority on how far
 * a learner had got. This puts the same fact on the server where it belongs,
 * under a command that cannot be talked into meaning more than it says.
 *
 * The body is capped at 8 KiB: the real payload is a revision, a position and a
 * bounded list of section codes. Anything larger is refused here rather than
 * forwarded.
 */
import { getAcademyConfig, AcademyConfigError } from "@/config/academy-config";
import { makeError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

export type LessonProgressProxyInput = {
  operation: "lesson-progress";
  stableCode: string;
};

const STABLE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const MAX_LESSON_PROGRESS_BODY_BYTES = 8 * 1024;
export const MAX_LESSON_PROGRESS_RESPONSE_BYTES = 64 * 1024;

const FORWARD_REQUEST_HEADERS = new Set([
  "cookie",
  "x-csrf-token",
  "accept",
  "content-type",
  // The Backend uses this as the idempotency key for the save.
  "idempotency-key",
  REQUEST_ID_HEADER,
]);
const FORWARD_RESPONSE_HEADERS = new Set(["content-type", "cache-control", REQUEST_ID_HEADER]);

function errorResponse(error: NormalizedError, status: number): Response {
  return new Response(JSON.stringify(error), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function buildForwardHeaders(request: Request): Headers {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (FORWARD_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  return headers;
}

function copyResponseHeaders(from: Headers, to: Headers): void {
  from.forEach((value, key) => {
    if (FORWARD_RESPONSE_HEADERS.has(key.toLowerCase())) to.set(key, value);
  });
  if (!to.has("cache-control")) to.set("cache-control", "no-store");
}

function resolveTargetPath(input: LessonProgressProxyInput): string | null {
  if (!STABLE_CODE_RE.test(input.stableCode)) return null;
  return `/api/curriculum/v2/levels/${encodeURIComponent(input.stableCode)}/lesson-progress`;
}

export async function proxyLessonProgress(
  request: Request,
  input: LessonProgressProxyInput,
): Promise<Response> {
  if (request.method !== "PATCH") {
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

  const path = resolveTargetPath(input);
  if (path === null) {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 400 }), 400);
  }

  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_LESSON_PROGRESS_BODY_BYTES) {
    return errorResponse(makeError("VALIDATION_ERROR", { status: 413 }), 413);
  }

  const target = `${config.backendOrigin}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  let backendResponse: Response;
  try {
    backendResponse = await fetch(target, {
      method: "PATCH",
      headers: buildForwardHeaders(request),
      body: raw,
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

  const body = await backendResponse.arrayBuffer();
  if (body.byteLength > MAX_LESSON_PROGRESS_RESPONSE_BYTES) {
    return errorResponse(makeError("MALFORMED_RESPONSE", { status: backendResponse.status }), 502);
  }

  const outHeaders = new Headers();
  copyResponseHeaders(backendResponse.headers, outHeaders);
  return new Response(body, { status: backendResponse.status, headers: outHeaders });
}
