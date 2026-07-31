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
 */

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
};

export const PROXY_ALLOW_LIST: Record<ProxyOperation, ProxyRoute> = {
  login: { method: "POST", backendPath: "/api/auth/login", isLogin: true, hasBody: true, forwardClientIp: false },
  session: { method: "GET", backendPath: "/api/auth/me", isLogin: false, hasBody: false, forwardClientIp: false },
  logout: { method: "POST", backendPath: "/api/auth/logout", isLogin: false, hasBody: false, forwardClientIp: false },
  csrf: { method: "GET", backendPath: "/api/csrf", isLogin: false, hasBody: false, forwardClientIp: false },
  register: {
    method: "POST",
    backendPath: "/api/auth/register",
    isLogin: false,
    hasBody: true,
    forwardClientIp: true,
  },
};

export function getProxyRoute(operation: ProxyOperation): ProxyRoute {
  return PROXY_ALLOW_LIST[operation];
}

export const PROXY_OPERATIONS = Object.keys(PROXY_ALLOW_LIST) as ProxyOperation[];
