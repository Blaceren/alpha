/**
 * The CRM staff-authentication contract, shared by the route handlers (server)
 * and the auth client (browser).
 *
 * The CRM's own auth API is deliberately much narrower than the backend's:
 *
 * - Login answers `{ ok: true }` and **no user payload**. The backend's login
 *   response carries `email`, `level` and `xp` — learner-shaped fields that have
 *   no business in a staff client. Identity comes from exactly one place,
 *   `GET /api/crm/v1/session`, which is already strict-schema'd. Two identity
 *   sources is how they drift.
 *
 * - Errors are a small closed set of stable codes. The backend's messages are
 *   Russian prose written for the learner product; CRM copy is chosen in the CRM
 *   and keyed off these codes. `requestId` is carried only as a support
 *   reference and is never rendered as an explanation.
 *
 * - `invalid_credentials` intentionally covers both "no such account" and "wrong
 *   password", because the backend deliberately answers both with one 401. Any
 *   finer distinction here would reintroduce the account enumeration the backend
 *   is avoiding.
 */
import { z } from "zod";

/* -------------------------------------------------------------- login input */

/**
 * Mirrors the backend `loginSchema` bounds (trimmed lowercase email, password of
 * at least 6 characters) so an obviously-invalid submission is answered locally
 * instead of costing a request and a rate-limit slot. The backend re-validates
 * regardless — this is an optimization, never the authority.
 *
 * `.strict()` keeps a stray field (a client-supplied `role`, say) from being
 * forwarded to the backend at all.
 */
export const LoginRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(6).max(200),
    /**
     * The solved Cloudflare Turnstile token (AFD-3A3).
     *
     * Optional here because the backend `loginSchema` declares it optional and
     * this schema mirrors that schema — omitting it is a REFUSAL at the backend,
     * never a bypass. The bound matches the backend's own 4 KiB token cap, so a
     * megabyte of junk is rejected on this origin instead of being forwarded.
     */
    captchaToken: z.string().trim().min(1).max(4096).optional(),
  })
  .strict();

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/* ------------------------------------------------------------ result codes */

/**
 * Every terminal outcome of a CRM login attempt. Closed union: an unmapped
 * backend status becomes `server_error` rather than a new silent code.
 */
export const LOGIN_ERROR_CODES = [
  "invalid_input",
  "invalid_credentials",
  /** Backend `ACCOUNT_BLOCKED` — the account exists but cannot sign in. */
  "inactive",
  /** Backend `EMAIL_NOT_VERIFIED`, kept distinct so the copy can be accurate. */
  "email_not_verified",
  /**
   * Authenticated at the backend, but the account is not usable as a CRM
   * employee. No session cookie is established on the CRM origin in this case —
   * see the login route handler.
   */
  "not_staff",
  "rate_limited",
  /**
   * AFD-3A3 — the three CAPTCHA outcomes the backend distinguishes. Kept
   * separate from `invalid_credentials` because telling an employee their
   * password is wrong when the challenge lapsed sends them to reset a password
   * that was fine, and separate from each other because one is the visitor's to
   * retry and two are the platform's to fix.
   */
  "captcha_failed",
  "captcha_unavailable",
  "captcha_configuration_error",
  "upstream_unavailable",
  "server_error",
] as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];

export const LoginErrorSchema = z
  .object({
    code: z.enum(LOGIN_ERROR_CODES),
    requestId: z.string().optional(),
  })
  .strict();

export const LoginSuccessSchema = z.object({ ok: z.literal(true) }).strict();

/* --------------------------------------------------------------- CSRF token */

/**
 * The double-submit token, echoed back to the client so it can send the
 * `x-csrf-token` header. The paired cookie is set by the same response through
 * the cookie bridge. 64 hex characters is what the backend mints; the bound is
 * asserted loosely (non-empty, sane length) rather than pinned to an exact
 * format, so a backend token-length change is not a CRM outage.
 */
export const CsrfTokenSchema = z
  .object({ csrfToken: z.string().min(16).max(512) })
  .strict();

export type CsrfTokenResponse = z.infer<typeof CsrfTokenSchema>;

/** The header name the backend's double-submit check reads. */
export const CSRF_HEADER_NAME = "x-csrf-token";

/* ------------------------------------------------------------- CRM API paths */

/**
 * The CRM-origin auth endpoints. These are real Next route handlers, not
 * rewrites: a rewrite cannot restrict the method, recompute cookie `Secure`,
 * drop a hostile `Domain`, or normalize the error envelope.
 */
export const CRM_AUTH_LOGIN_PATH = "/api/crm/auth/login";
export const CRM_AUTH_LOGOUT_PATH = "/api/crm/auth/logout";
export const CRM_AUTH_CSRF_PATH = "/api/crm/auth/csrf";
