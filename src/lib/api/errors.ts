/**
 * Normalized API error contract.
 *
 * Every failure the Academy surfaces — from the proxy, the API client or the
 * session bootstrap — is mapped into a single `NormalizedError` shape. UI code
 * never sees a raw Backend envelope, a raw fetch exception or a raw status
 * code; it sees a stable category + a safe message key. Request IDs are
 * preserved for support without leaking internal detail.
 */

export type ErrorCategory =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_CREDENTIALS"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "NETWORK_ERROR"
  | "BACKEND_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "CONFIGURATION_ERROR"
  | "UNKNOWN_ERROR";

export type NormalizedError = {
  category: ErrorCategory;
  /** HTTP status when the failure came from a response, else null. */
  status: number | null;
  /** Safe public code from the Backend envelope (e.g. "ACCOUNT_BLOCKED"), else null. */
  code: string | null;
  /** Stable, generic message key for i18n. Never a raw Backend string. */
  messageKey: string;
  /** Correlation id for support. Never a credential or cookie. */
  requestId: string | null;
  retryable: boolean;
};

const RETRYABLE: ReadonlySet<ErrorCategory> = new Set<ErrorCategory>([
  "NETWORK_ERROR",
  "BACKEND_UNAVAILABLE",
  "RATE_LIMITED",
]);

const MESSAGE_KEY: Record<ErrorCategory, string> = {
  UNAUTHENTICATED: "auth.error.unauthenticated",
  FORBIDDEN: "auth.error.forbidden",
  INVALID_CREDENTIALS: "auth.error.invalidCredentials",
  VALIDATION_ERROR: "auth.error.validation",
  RATE_LIMITED: "auth.error.rateLimited",
  CONFLICT: "auth.error.conflict",
  NETWORK_ERROR: "auth.error.network",
  BACKEND_UNAVAILABLE: "auth.error.backendUnavailable",
  MALFORMED_RESPONSE: "auth.error.malformedResponse",
  CONFIGURATION_ERROR: "auth.error.configuration",
  UNKNOWN_ERROR: "auth.error.unknown",
};

export type NormalizeArgs = {
  status: number;
  /** Parsed JSON body if any (already validated as an object). */
  body?: unknown;
  requestId?: string | null;
  /**
   * `true` when normalizing a login response. A 401 on login is
   * INVALID_CREDENTIALS; a 401 elsewhere is UNAUTHENTICATED.
   */
  isLogin?: boolean;
};

function readCode(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body) {
    const value = (body as { error: unknown }).error;
    if (typeof value === "string" && value.length > 0 && value.length <= 64) {
      // Only pass through short, code-like values. A long human string
      // (e.g. "Неверный email или пароль") is not a stable code — drop it.
      if (/^[A-Z0-9_]+$/.test(value)) return value;
    }
  }
  return null;
}

function categoryForStatus(status: number, isLogin: boolean): ErrorCategory {
  if (status === 401) return isLogin ? "INVALID_CREDENTIALS" : "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 400 || status === 422) return "VALIDATION_ERROR";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "BACKEND_UNAVAILABLE";
  return "UNKNOWN_ERROR";
}

export function makeError(
  category: ErrorCategory,
  extra: Partial<Omit<NormalizedError, "category" | "messageKey" | "retryable">> = {},
): NormalizedError {
  return {
    category,
    status: extra.status ?? null,
    code: extra.code ?? null,
    requestId: extra.requestId ?? null,
    messageKey: MESSAGE_KEY[category],
    retryable: RETRYABLE.has(category),
  };
}

/** Normalize an HTTP error response into a NormalizedError. */
export function normalizeHttpError(args: NormalizeArgs): NormalizedError {
  const category = categoryForStatus(args.status, args.isLogin ?? false);
  return {
    category,
    status: args.status,
    code: readCode(args.body),
    requestId: args.requestId ?? null,
    messageKey: MESSAGE_KEY[category],
    retryable: RETRYABLE.has(category),
  };
}

export const REQUEST_ID_HEADER = "x-request-id";
