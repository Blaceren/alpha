/**
 * Browser clients for the three CRM auth endpoints.
 *
 * Relative paths only. The browser never learns `CRM_BACKEND_ORIGIN` — these hit
 * the CRM's own route handlers, which call the backend server-side. That is what
 * keeps the session cookie host-only and removes any need for CORS.
 *
 * Nothing here persists anything. No token in `localStorage`, no token in
 * `sessionStorage`, no identity cache: the session lives only in the HttpOnly
 * cookie the browser manages, and the CSRF token lives only in a module-scoped
 * variable for the lifetime of the page.
 */
import {
  CRM_AUTH_CSRF_PATH,
  CRM_AUTH_LOGIN_PATH,
  CRM_AUTH_LOGOUT_PATH,
  CSRF_HEADER_NAME,
  CsrfTokenSchema,
  LoginErrorSchema,
  LOGIN_ERROR_CODES,
  type LoginErrorCode,
} from "@/data/contracts/api/auth";

export const AUTH_TIMEOUT_MS = 8_000;

export type LoginOutcome =
  | { status: "success" }
  | { status: "failed"; code: LoginErrorCode; requestId?: string };

export type LogoutOutcome = { status: "done" };

export interface AuthRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injection seam for tests; production always uses global fetch. */
  fetchImpl?: typeof fetch;
}

function withTimeout(options: AuthRequestOptions) {
  const { signal, timeoutMs = AUTH_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort);
  return {
    signal: controller.signal,
    release() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onExternalAbort);
    },
  };
}

/* ------------------------------------------------------------------- CSRF */

/**
 * The current double-submit token, held in memory only.
 *
 * Module scope rather than `sessionStorage` is deliberate: the token needs to
 * survive a few fetches, not a page reload, and anything persisted is something
 * that can be read back later by script running on the origin. A reload simply
 * fetches a fresh one.
 */
let csrfToken: string | null = null;

/** Test-only reset so one test's token cannot leak into the next. */
export function resetCsrfTokenForTests(): void {
  csrfToken = null;
}

/**
 * Fetch (or reuse) the CSRF token. The paired cookie is set by the same response
 * via the server-side cookie bridge, so cookie and header always agree.
 */
export async function ensureCsrfToken(options: AuthRequestOptions = {}): Promise<string | null> {
  if (csrfToken) return csrfToken;

  const { fetchImpl = fetch } = options;
  const timeout = withTimeout(options);
  try {
    const response = await fetchImpl(CRM_AUTH_CSRF_PATH, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: timeout.signal,
    });
    if (!response.ok) return null;

    const parsed = CsrfTokenSchema.safeParse(await response.json());
    if (!parsed.success) return null;

    csrfToken = parsed.data.csrfToken;
    return csrfToken;
  } catch {
    return null;
  } finally {
    timeout.release();
  }
}

/**
 * Headers for a state-changing CRM request that the backend CSRF-checks.
 *
 * Exported as the one bounded helper so later phases — the MR-1 reviewer
 * decisions in particular — reuse this rather than each inventing their own
 * token plumbing.
 */
export async function csrfHeaders(
  options: AuthRequestOptions = {},
): Promise<Record<string, string>> {
  const token = await ensureCsrfToken(options);
  return token ? { [CSRF_HEADER_NAME]: token } : {};
}

/* ------------------------------------------------------------------ login */

function toLoginErrorCode(value: unknown): LoginErrorCode {
  const parsed = LoginErrorSchema.safeParse(value);
  if (parsed.success) return parsed.data.code;
  // A body we cannot read is not a credential problem — never report it as one,
  // or the employee is told their password is wrong when the service is broken.
  return "server_error";
}

/**
 * Login options (AFD-3A3).
 *
 * The token is an OPTION rather than a positional parameter so the existing
 * `login(email, password, { fetchImpl })` call shape is unchanged — a new
 * positional argument in the middle would silently reinterpret every existing
 * caller's third argument.
 */
export interface LoginOptions extends AuthRequestOptions {
  /**
   * The solved Turnstile token. Travels in the JSON body only — never a header,
   * never a query parameter, never anything that could be persisted or logged
   * along the way. `undefined` omits the field entirely, which the backend
   * treats as a refusal wherever login verification is enforced.
   */
  captchaToken?: string;
}

export async function login(
  email: string,
  password: string,
  options: LoginOptions = {},
): Promise<LoginOutcome> {
  const { fetchImpl = fetch, captchaToken } = options;
  const timeout = withTimeout(options);

  try {
    const response = await fetchImpl(CRM_AUTH_LOGIN_PATH, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      // Exactly three fields travel, and only ever these. No role, no actor,
      // no return path — the route's `.strict()` schema would reject a fourth.
      //
      // The email is trimmed here as well as by the server schema, so a value
      // copy-pasted with a trailing space produces the same request whichever
      // caller sent it. The server remains the authority.
      body: JSON.stringify({
        email: email.trim(),
        password,
        ...(captchaToken ? { captchaToken } : {}),
      }),
      signal: timeout.signal,
    });

    if (response.status === 200) {
      // A fresh session invalidates any token minted for the previous one.
      csrfToken = null;
      return { status: "success" };
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    const parsed = LoginErrorSchema.safeParse(body);
    const code = toLoginErrorCode(body);
    return {
      status: "failed",
      code,
      ...(parsed.success && parsed.data.requestId ? { requestId: parsed.data.requestId } : {}),
    };
  } catch {
    // Abort and timeout both land here. Reported as a transport failure, never
    // as a rejected credential.
    return { status: "failed", code: "upstream_unavailable" };
  } finally {
    timeout.release();
  }
}

/* ----------------------------------------------------------------- logout */

/**
 * Sign out. Always resolves `done`: the CRM route clears the cookies regardless
 * of what the backend answered, so from the browser's perspective the session is
 * over either way. Surfacing a failure would invite the employee to "retry"
 * something that already succeeded locally.
 */
export async function logout(options: AuthRequestOptions = {}): Promise<LogoutOutcome> {
  const { fetchImpl = fetch } = options;
  const timeout = withTimeout(options);
  try {
    const headers = await csrfHeaders({ ...options, fetchImpl });
    await fetchImpl(CRM_AUTH_LOGOUT_PATH, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...headers },
      body: "{}",
      signal: timeout.signal,
    });
  } catch {
    // Ignored on purpose — see the doc comment.
  } finally {
    csrfToken = null;
    timeout.release();
  }
  return { status: "done" };
}

/** Re-exported so tests can assert the closed code set without a second list. */
export { LOGIN_ERROR_CODES };
