/**
 * SERVER-ONLY: the bounded backend client.
 *
 * Every CRM route handler that talks to the backend goes through here. It exists
 * so that "the CRM can reach the backend" never becomes "the CRM will forward
 * anything anywhere":
 *
 * - **The path is an allowlist, not a parameter.** Callers pass a
 *   `BackendAuthPath` union member, so there is no string a request can steer.
 *   A wildcard here would turn the CRM origin into an open proxy onto every
 *   present and future backend route — the same reasoning that keeps
 *   `next-rewrites.ts` free of `:path*`.
 *
 * - **The origin comes from validated server config.** `CRM_BACKEND_ORIGIN` is
 *   parsed by `parseBackendOrigin` (http(s), no credentials, no query, no hash,
 *   no path) and never reaches the browser.
 *
 * - **The response is not returned raw.** Callers get a status, the parsed JSON
 *   body and the bridged cookies. Nothing streams a backend response object
 *   straight through, so a stray backend header cannot reach the client by
 *   accident.
 *
 * - **Nothing sensitive is logged.** No request body, no cookie header, no CSRF
 *   token, no exception text. A login body contains a password; the one thing
 *   this module must never do is write it anywhere.
 *
 * Why route handlers rather than more Next rewrites: a rewrite cannot restrict
 * the method, cannot recompute `Secure`, cannot drop a hostile `Domain`, and
 * cannot normalize an error envelope. The already-shipped `/api/crm/v1/*` data
 * paths stay rewrites — they need none of that — and auth is handled here.
 */
import { parseBackendOrigin } from "@/config/backend-origin";
import { bridgeSetCookies, type BridgedCookie } from "@/server/set-cookie-bridge";

/**
 * Exactly the backend paths the CRM server may call. Each is a deliberate
 * decision. Adding one is a reviewed change, never a side effect — the same
 * contract the rewrite allowlist follows.
 */
export const BACKEND_PATHS = {
  login: "/api/auth/login",
  logout: "/api/auth/logout",
  csrf: "/api/csrf",
  /**
   * The backend-computed CRM staff identity. Called server-side during login to
   * decide whether the freshly authenticated account is staff at all — see
   * `app/api/crm/auth/login/route.ts`. The browser reads the same endpoint
   * through the existing rewrite; this entry is the server-side path.
   */
  session: "/api/crm/v1/session",
} as const;

export type BackendPath = (typeof BACKEND_PATHS)[keyof typeof BACKEND_PATHS];

export const BACKEND_TIMEOUT_MS = 8_000;

export type BackendCallResult =
  | {
      status: "responded";
      httpStatus: number;
      /** Parsed JSON, or null when the body was absent or not JSON. */
      body: unknown;
      cookies: BridgedCookie[];
    }
  /** Network failure, DNS failure, timeout or abort. Never carries detail. */
  | { status: "unreachable" }
  /** `CRM_BACKEND_ORIGIN` is missing or invalid. A configuration fault. */
  | { status: "misconfigured" };

export interface BackendCallInput {
  path: BackendPath;
  method: "GET" | "POST";
  /** Serialized as JSON. Never logged. */
  json?: unknown;
  /**
   * Cookie header to forward verbatim. This is how the caller's staff session
   * and CSRF cookie reach the backend: the browser sends them to the CRM origin,
   * and the CRM forwards them server-side.
   */
  cookie?: string | null;
  /** Double-submit CSRF header, forwarded when the backend requires it. */
  csrfToken?: string | null;
  timeoutMs?: number;
  /** Injection seam for tests; production always uses global fetch. */
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}

export async function callBackend(input: BackendCallInput): Promise<BackendCallResult> {
  const env = input.env ?? (process.env as Record<string, string | undefined>);
  const origin = parseBackendOrigin(env.CRM_BACKEND_ORIGIN);
  if (!origin.ok) return { status: "misconfigured" };

  const { fetchImpl = fetch, timeoutMs = BACKEND_TIMEOUT_MS } = input;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (input.json !== undefined) headers["Content-Type"] = "application/json";
    if (input.cookie) headers.Cookie = input.cookie;
    if (input.csrfToken) headers["x-csrf-token"] = input.csrfToken;

    const response = await fetchImpl(`${origin.origin}${input.path}`, {
      method: input.method,
      headers,
      ...(input.json !== undefined ? { body: JSON.stringify(input.json) } : {}),
      // The backend is another origin from the browser's point of view, but this
      // is a server-to-server call: there is no ambient cookie jar to include.
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // A non-JSON or empty body is not an error by itself — the status is what
      // callers branch on. Deliberately not logged: it may echo credentials.
      body = null;
    }

    return {
      status: "responded",
      httpStatus: response.status,
      body,
      cookies: bridgeSetCookies(response.headers, env),
    };
  } catch {
    // Timeout, abort, DNS and connection failures all land here. No exception
    // text escapes: it can contain the backend origin, which is server-only.
    return { status: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
