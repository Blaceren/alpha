/**
 * The one Academy API client.
 *
 * Page/component code never calls `fetch` directly — it calls these functions.
 * All calls target the Academy same-origin proxy (`/api/backend/*`), so the
 * httpOnly session cookie is sent automatically by the browser and no token is
 * ever handled in JavaScript.
 *
 * Rules (CI-1):
 *   - JSON parsing is bounded and content-type validated;
 *   - request ids are captured;
 *   - no automatic retry for login/logout mutations;
 *   - the session GET gets ONE retry, only for a transient network failure;
 *   - no retry on 401/403/409/validation;
 *   - no fixture fallback — an API failure is an error, never a fake session.
 */
import {
  makeError,
  normalizeHttpError,
  REQUEST_ID_HEADER,
  type NormalizedError,
} from "@/lib/api/errors";
import {
  isBackendCsrfResponse,
  isBackendLoginResponse,
  isBackendRegisterResponse,
  isBackendSessionResponse,
  type BackendLoginResponse,
  type BackendRegisterResponse,
  type BackendSessionResponse,
} from "@/lib/api/types";

export const PROXY_BASE = "/api/backend";

/** 256 KiB cap on a response body we are willing to parse. */
const MAX_RESPONSE_BYTES = 256 * 1024;

export type ApiResult<T> =
  | { ok: true; data: T; requestId: string | null }
  | { ok: false; error: NormalizedError };

export type LoginCredentials = {
  email: string;
  password: string;
  /**
   * The solved Turnstile token (AFD-3A3). Optional in the TYPE because the
   * Backend `loginSchema` declares it optional — omitting it is a refusal there,
   * not a bypass. It travels in the JSON body only: never a header, never a
   * query parameter, and never anywhere it could be persisted.
   */
  captchaToken?: string;
};

type RequestOptions = {
  method: "GET" | "POST";
  path: string;
  jsonBody?: unknown;
  csrfToken?: string;
  isLogin?: boolean;
  signal?: AbortSignal;
};

async function readBoundedJson(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { ok: false };
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

async function performRequest(options: RequestOptions): Promise<Response> {
  const headers = new Headers({ accept: "application/json" });
  if (options.jsonBody !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (options.csrfToken) {
    headers.set("x-csrf-token", options.csrfToken);
  }
  return fetch(options.path, {
    method: options.method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    body: options.jsonBody !== undefined ? JSON.stringify(options.jsonBody) : undefined,
    signal: options.signal,
  });
}

/**
 * Core request primitive. Returns a normalized result. `retryOnNetwork` is used
 * ONLY by the session GET, and only re-attempts a genuine network throw once.
 */
async function apiRequest<T>(
  options: RequestOptions & { validate: (value: unknown) => value is T; retryOnNetwork?: boolean },
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await performRequest(options);
  } catch {
    if (options.retryOnNetwork) {
      try {
        response = await performRequest(options);
      } catch {
        return { ok: false, error: makeError("NETWORK_ERROR") };
      }
    } else {
      return { ok: false, error: makeError("NETWORK_ERROR") };
    }
  }

  const requestId = response.headers.get(REQUEST_ID_HEADER);

  if (!response.ok) {
    const parsed = await readBoundedJson(response);
    return {
      ok: false,
      error: normalizeHttpError({
        status: response.status,
        body: parsed.ok ? parsed.value : undefined,
        requestId,
        isLogin: options.isLogin,
      }),
    };
  }

  const parsed = await readBoundedJson(response);
  if (!parsed.ok || !options.validate(parsed.value)) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE", { status: response.status, requestId }) };
  }

  return { ok: true, data: parsed.value, requestId };
}

export function fetchSession(signal?: AbortSignal): Promise<ApiResult<BackendSessionResponse>> {
  return apiRequest<BackendSessionResponse>({
    method: "GET",
    path: `${PROXY_BASE}/auth/me`,
    validate: isBackendSessionResponse,
    retryOnNetwork: true,
    signal,
  });
}

export function login(credentials: LoginCredentials): Promise<ApiResult<BackendLoginResponse>> {
  return apiRequest<BackendLoginResponse>({
    method: "POST",
    path: `${PROXY_BASE}/auth/login`,
    jsonBody: {
      email: credentials.email,
      password: credentials.password,
      // Mirrors the register client: the field is present only when there is a
      // real token, so a `undefined` never serialises into the body.
      ...(credentials.captchaToken ? { captchaToken: credentials.captchaToken } : {}),
    },
    isLogin: true,
    validate: isBackendLoginResponse,
  });
}

/**
 * Fields the Academy is willing to send to the registration owner.
 *
 * This mirrors the authoritative Backend `registerSchema` EXACTLY — `email` and
 * `password` required, `name`, `referralCode` and `captchaToken` optional — and
 * invents nothing (no first/last name, phone, Telegram, country, consent or
 * trading-experience field exists in that schema).
 *
 * The password-confirmation field on the form is client-only and never appears
 * here.
 */
export type RegistrationInput = {
  email: string;
  password: string;
  name?: string;
  referralCode?: string;
  captchaToken?: string;
};

/**
 * Register a new account (AFD-3A).
 *
 * No auto-retry: registration is a mutation, and a silent second attempt could
 * both create a duplicate and burn one of the caller's 3 rate-limited attempts.
 * Optional fields are omitted from the payload entirely rather than sent as
 * empty strings, which Backend's `.min(1)` would reject.
 */
export function register(
  input: RegistrationInput,
  signal?: AbortSignal,
): Promise<ApiResult<BackendRegisterResponse>> {
  const jsonBody: Record<string, string> = {
    email: input.email,
    password: input.password,
  };
  if (input.name) jsonBody.name = input.name;
  if (input.referralCode) jsonBody.referralCode = input.referralCode;
  if (input.captchaToken) jsonBody.captchaToken = input.captchaToken;

  return apiRequest<BackendRegisterResponse>({
    method: "POST",
    path: `${PROXY_BASE}/auth/register`,
    jsonBody,
    validate: isBackendRegisterResponse,
    signal,
  });
}

async function fetchCsrfToken(): Promise<ApiResult<string>> {
  const result = await apiRequest({
    method: "GET",
    path: `${PROXY_BASE}/csrf`,
    validate: isBackendCsrfResponse,
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data.csrfToken, requestId: result.requestId };
}

/**
 * Logout is a Backend mutation guarded by double-submit CSRF: we first bootstrap
 * a CSRF token, then send it as the `x-csrf-token` header. No auto-retry.
 */
export async function logout(): Promise<ApiResult<{ ok: true }>> {
  const csrf = await fetchCsrfToken();
  if (!csrf.ok) return csrf;

  return apiRequest<{ ok: true }>({
    method: "POST",
    path: `${PROXY_BASE}/auth/logout`,
    csrfToken: csrf.data,
    validate: (value): value is { ok: true } =>
      typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === true,
  });
}
