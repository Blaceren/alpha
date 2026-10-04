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
 *
 * ACCOUNT RECOVERY (2026-10-01) names the routes behind the password reset, the
 * confirmation of an address and its change — including `verify-email` and
 * `resend-verification`, which were deliberately unreachable while the product
 * could send no mail. There is still no passthrough: eight more named
 * operations, each one method and one constant path. Whether any of them does
 * anything is the Backend's answer (`capabilities`): where no mail can be sent
 * it refuses them, and the Academy does not offer them.
 */
import type { BackendAuthSurface } from "@/server/proxy/auth-surface";

export type ProxyOperation =
  | "login"
  | "session"
  | "logout"
  | "csrf"
  | "register"
  | "changePassword"
  | "account"
  | "passwordResetRequest"
  | "passwordResetConfirm"
  | "verifyEmail"
  | "resendVerification"
  | "emailChangeRequest"
  | "emailChangeCancel"
  | "emailChangeConfirm";

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
    /* 2026-10-04, launch audit: the Backend limits logout to 20 per 10 minutes
       PER ADDRESS. Without the learner's address every logout of every learner
       arrived from this proxy's own, so they shared one bucket of twenty — and
       a refused logout revoked nothing. */
    forwardClientIp: true,
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
  /**
   * ATA-PROFILE-FOUNDATION-1 — the learner changes their own password.
   *
   * `isLogin: false` on purpose. A 401 here means the SESSION is gone, not
   * that a credential was wrong: the route is authenticated, and a wrong
   * current password answers 400. Marking it as a login would teach the
   * shell to read an expired session as a typo.
   *
   * `forwardClientIp` because Backend rate-limits this route on (user, IP).
   * Without it every attempt in the world would share one bucket keyed on
   * the loopback hop — the same reasoning that put it on `login`.
   *
   * The body is forwarded rather than rebuilt, which is safe here for a
   * reason that does not hold for `PATCH /api/me`: the Backend schema is a
   * closed two-field object, so an extra key is stripped rather than acted
   * on. There is no adjacent field to widen into.
   *
   * The rotated session cookie returns through the same Set-Cookie
   * preservation every auth response uses. Dropping it would sign the
   * learner out at the moment they proved who they were.
   */
  changePassword: {
    method: "POST",
    backendPath: "/api/auth/change-password",
    isLogin: false,
    hasBody: true,
    forwardClientIp: true,
    authSurface: null,
  },

  /* ------------------------------------------------- ACCOUNT RECOVERY --
     The learner's own address and what can be done with it. Authenticated,
     read-only, no body. */
  account: {
    method: "GET",
    backendPath: "/api/me/account",
    isLogin: false,
    hasBody: false,
    forwardClientIp: false,
    authSurface: null,
  },
  /* Ask for a reset link. Anonymous; the Backend limits it by client address,
     so the trusted address is forwarded, and it verifies a challenge minted for
     THIS surface — a login or registration token is refused here. */
  passwordResetRequest: {
    method: "POST",
    backendPath: "/api/auth/password-reset/request",
    isLogin: false,
    hasBody: true,
    forwardClientIp: true,
    authSurface: "academy_password_reset",
  },
  /* Set a new password with a link's token. `isLogin: false`: a dead link is a
     400, and nothing here is a credential check the shell should interpret. */
  passwordResetConfirm: {
    method: "POST",
    backendPath: "/api/auth/password-reset/confirm",
    isLogin: false,
    hasBody: true,
    forwardClientIp: true,
    authSurface: null,
  },
  /* Confirm the address with a link's token. Anonymous: the link may be opened
     on another device. */
  verifyEmail: {
    method: "POST",
    backendPath: "/api/auth/verify-email",
    isLogin: false,
    hasBody: true,
    forwardClientIp: false,
    authSurface: null,
  },
  /* Send the confirmation message again. Authenticated, CSRF, no body. */
  resendVerification: {
    method: "POST",
    backendPath: "/api/auth/resend-verification",
    isLogin: false,
    hasBody: false,
    forwardClientIp: false,
    authSurface: null,
  },
  /* Ask to change the address: the new address and the current password. A
     wrong password is a 400 from the route, never a 401. */
  emailChangeRequest: {
    method: "POST",
    backendPath: "/api/me/email-change",
    isLogin: false,
    hasBody: true,
    forwardClientIp: false,
    authSurface: null,
  },
  /* Withdraw a pending change. Authenticated, CSRF, no body. */
  emailChangeCancel: {
    method: "POST",
    backendPath: "/api/me/email-change/cancel",
    isLogin: false,
    hasBody: false,
    forwardClientIp: false,
    authSurface: null,
  },
  /* Confirm the new address with a link's token. Anonymous, like `verifyEmail`,
     and limited by client address at the Backend. */
  emailChangeConfirm: {
    method: "POST",
    backendPath: "/api/auth/email-change/confirm",
    isLogin: false,
    hasBody: true,
    forwardClientIp: true,
    authSurface: null,
  },
};

export function getProxyRoute(operation: ProxyOperation): ProxyRoute {
  return PROXY_ALLOW_LIST[operation];
}

export const PROXY_OPERATIONS = Object.keys(PROXY_ALLOW_LIST) as ProxyOperation[];
