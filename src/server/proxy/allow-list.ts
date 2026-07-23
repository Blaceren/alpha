/**
 * Bounded proxy allow-list.
 *
 * The Academy same-origin proxy is NOT an arbitrary HTTP proxy. It exposes
 * exactly the four auth operations CI-1 needs, each pinned to one HTTP method
 * and one Backend path. The Backend path is a constant here — it is never
 * derived from caller input (no host, no absolute URL, no path segment from the
 * request), which is what makes SSRF structurally impossible.
 */

export type ProxyOperation = "login" | "session" | "logout" | "csrf";

export type ProxyRoute = {
  method: "GET" | "POST";
  backendPath: string;
  /** A 401 on this operation means bad credentials, not an expired session. */
  isLogin: boolean;
  /** Whether this operation forwards a request body. */
  hasBody: boolean;
};

export const PROXY_ALLOW_LIST: Record<ProxyOperation, ProxyRoute> = {
  login: { method: "POST", backendPath: "/api/auth/login", isLogin: true, hasBody: true },
  session: { method: "GET", backendPath: "/api/auth/me", isLogin: false, hasBody: false },
  logout: { method: "POST", backendPath: "/api/auth/logout", isLogin: false, hasBody: false },
  csrf: { method: "GET", backendPath: "/api/csrf", isLogin: false, hasBody: false },
};

export function getProxyRoute(operation: ProxyOperation): ProxyRoute {
  return PROXY_ALLOW_LIST[operation];
}

export const PROXY_OPERATIONS = Object.keys(PROXY_ALLOW_LIST) as ProxyOperation[];
