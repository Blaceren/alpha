/**
 * Bounded proxy allow-list.
 *
 * The Academy same-origin proxy is NOT an arbitrary HTTP proxy. It exposes
 * exactly the auth operations the Academy needs, each pinned to one HTTP method
 * and one Backend path. The Backend path is a constant here — it is never
 * derived from caller input (no host, no absolute URL, no path segment from the
 * request), which is what makes SSRF structurally impossible.
 *
 * AFD-3A adds exactly ONE operation — `register` — for the public registration
 * surface. There is deliberately no generic `/api/auth/*` passthrough: an
 * operation that is not named here cannot be reached, so adjacent Backend auth
 * routes (verify-email, resend-verification, session-status) stay unreachable
 * from the browser.
 *
 * AFD-3A3 adds NO operation. It changes two properties of the existing `login`
 * entry — the trusted client IP is now forwarded, and the Backend is told which
 * authentication surface this is — and it names the surface for `register`
 * explicitly rather than leaving it implied.
 */
import type { BackendAuthSurface } from "@/server/proxy/auth-surface";

export type ProxyOperation = "login" | "session" | "logout" | "csrf" | "register";

export type ProxyRoute = {
  method: "GET" | "POST";
  backendPath: string;
  /** A 401 on this operation means bad credentials, not an expired session. */
  isLogin: boolean;
  /** Whether this operation forwards a request body. */
  hasBody: boolean;
  /**
   * Whether the trusted ingress client IP is forwarded to Backend (AFD-3A).
   *
   * Backend rate-limits registration by client IP. Without this the loopback
   * fetch would present no IP at all and every public registration attempt on
   * the internet would share ONE Backend rate-limit bucket. Only the value the
   * trusted ingress hop stamped is forwarded — never a browser-supplied one.
   * See `client-ip.ts` for why that is safe.
   */
  forwardClientIp: boolean;
  /**
   * The Backend authentication surface this operation submits to, or `null` for
   * operations that raise no challenge (session, logout, csrf).
   *
   * The Backend pins one expected Turnstile action per surface and refuses a
   * token minted for a different one, so this value decides which tokens the
   * Backend will accept for this route. It is a CONSTANT here — never derived
   * from the request — and the proxy `set`s it under the header named in
   * `auth-surface.ts`, which is absent from the forwarded-header allow-list, so
   * a browser cannot supply, influence or survive it.
   */
  authSurface: BackendAuthSurface | null;
};

export const PROXY_ALLOW_LIST: Record<ProxyOperation, ProxyRoute> = {
  login: {
    method: "POST",
    backendPath: "/api/auth/login",
    isLogin: true,
    hasBody: true,
    // AFD-3A3. Backend rate-limits login on (client IP, email) at 5 per 10
    // minutes. Before this, the loopback hop meant every public login attempt
    // shared ONE bucket keyed on 127.0.0.1 — five wrong passwords anywhere on
    // the internet locked that email out for everyone, and an attacker could
    // deliberately spend another account's slots. The same reasoning that put
    // this on `register` applies here, only more sharply.
    forwardClientIp: true,
    authSurface: "academy_login",
  },
  session: {
    method: "GET",
    backendPath: "/api/auth/me",
    isLogin: false,
    hasBody: false,
    forwardClientIp: false,
    authSurface: null,
  },
  logout: {
    method: "POST",
    backendPath: "/api/auth/logout",
    isLogin: false,
    hasBody: false,
    forwardClientIp: false,
    authSurface: null,
  },
  csrf: {
    method: "GET",
    backendPath: "/api/csrf",
    isLogin: false,
    hasBody: false,
    forwardClientIp: false,
    authSurface: null,
  },
  register: {
    method: "POST",
    backendPath: "/api/auth/register",
    isLogin: false,
    hasBody: true,
    forwardClientIp: true,
    authSurface: "academy_register",
  },
};

export function getProxyRoute(operation: ProxyOperation): ProxyRoute {
  return PROXY_ALLOW_LIST[operation];
}

export const PROXY_OPERATIONS = Object.keys(PROXY_ALLOW_LIST) as ProxyOperation[];
