/**
 * Bounded error taxonomy for curriculum/progression reads.
 *
 * Distinguishes the states CI-2 §18 requires. A disabled feature is 404
 * NOT_FOUND from the Backend (indistinguishable from a missing route by design)
 * and surfaces as FEATURE_DISABLED — never as "no lessons". No raw Backend
 * string reaches the UI; only a category, a stable code and a request id.
 */
export type CurriculumErrorCategory =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "FEATURE_DISABLED"
  | "NO_ACTIVE_CURRICULUM"
  | "NOT_ENROLLED"
  | "LEVEL_NOT_FOUND"
  | "LEVEL_LOCKED"
  | "UNSUPPORTED_LEVEL_TYPE"
  | "MALFORMED_RESPONSE"
  | "BACKEND_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "CONFIGURATION_ERROR"
  | "UNKNOWN_ERROR";

export type CurriculumReadError = {
  category: CurriculumErrorCategory;
  status: number | null;
  code: string | null;
  requestId: string | null;
  retryable: boolean;
};

const RETRYABLE: ReadonlySet<CurriculumErrorCategory> = new Set([
  "NETWORK_ERROR",
  "BACKEND_UNAVAILABLE",
]);

export function makeReadError(
  category: CurriculumErrorCategory,
  extra: Partial<Pick<CurriculumReadError, "status" | "code" | "requestId">> = {},
): CurriculumReadError {
  return {
    category,
    status: extra.status ?? null,
    code: extra.code ?? null,
    requestId: extra.requestId ?? null,
    retryable: RETRYABLE.has(category),
  };
}

function codeOf(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body) {
    const v = (body as { error: unknown }).error;
    if (typeof v === "string" && /^[A-Z0-9_]+$/.test(v)) return v;
  }
  return null;
}

/** Categorize a non-2xx response from GET /current. */
export function categorizeCurrentHttp(status: number, body: unknown, requestId: string | null): CurriculumReadError {
  const code = codeOf(body);
  if (status === 404) return makeReadError("FEATURE_DISABLED", { status, code, requestId });
  if (status === 401) return makeReadError("UNAUTHENTICATED", { status, code, requestId });
  if (status === 403) return makeReadError("FORBIDDEN", { status, code, requestId });
  if (status === 409) return makeReadError("MALFORMED_RESPONSE", { status, code, requestId }); // state corrupt
  if (status === 400) return makeReadError("UNKNOWN_ERROR", { status, code, requestId });
  if (status >= 500) return makeReadError("BACKEND_UNAVAILABLE", { status, code, requestId });
  return makeReadError("UNKNOWN_ERROR", { status, code, requestId });
}

/**
 * Categorize a non-2xx response from the content route into the content
 * unavailable reason (content failures are non-fatal for level detail).
 */
export type ContentUnavailable =
  | "not_configured"
  | "locked"
  | "not_enrolled"
  | "unsupported_type"
  | "unavailable"
  | "feature_disabled";

export function categorizeContentHttp(status: number, body: unknown): ContentUnavailable {
  const code = codeOf(body);
  const issue =
    body && typeof body === "object" && Array.isArray((body as { issues?: unknown }).issues)
      ? ((body as { issues: Array<{ code?: unknown }> }).issues[0]?.code as string | undefined)
      : undefined;

  if (status === 404 && code === "NOT_FOUND") return "feature_disabled";
  if (code === "CONTENT_LEVEL_LOCKED") return "locked";
  if (code === "CONTENT_NOT_ENROLLED") return "not_enrolled";
  if (code === "CONTENT_UNAVAILABLE") {
    if (issue === "content_not_configured") return "not_configured";
    if (issue === "unsupported_level_type") return "unsupported_type";
    return "unavailable";
  }
  return "unavailable";
}
