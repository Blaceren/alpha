import { NextResponse } from "next/server";
import {
  LoginRequestSchema,
  type LoginErrorCode,
} from "@/data/contracts/api/auth";
import {
  BACKEND_PATHS,
  CRM_LOGIN_SURFACE,
  callBackend,
} from "@/server/backend-client";
import { applyBridgedCookies, noStoreJson } from "@/server/auth-response";
import { deriveTrustedClientIp } from "@/server/client-ip";
import { SESSION_COOKIE_NAME } from "@/server/set-cookie-bridge";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Pull a support reference out of a backend error body without trusting it. */
function safeRequestId(body: unknown): string | undefined {
  if (typeof body === "object" && body !== null && "requestId" in body) {
    const value = (body as { requestId?: unknown }).requestId;
    if (typeof value === "string" && value !== "" && value.length <= 200) return value;
  }
  return undefined;
}

/** Read the backend's stable `error` discriminator, ignoring its prose message. */
function backendErrorCode(body: unknown): string | null {
  if (typeof body === "object" && body !== null && "error" in body) {
    const value = (body as { error?: unknown }).error;
    if (typeof value === "string") return value;
  }
  return null;
}

/**
 * Map a backend login status onto a CRM code.
 *
 * 401 collapses "no such account" and "wrong password" exactly as the backend
 * does — preserving that is what keeps the endpoint free of account enumeration.
 */
/**
 * The backend's CAPTCHA codes, mapped onto CRM codes (AFD-3A3).
 *
 * Consulted BEFORE the status, because the status alone is ambiguous: 400 covers
 * both a malformed body and a rejected challenge, and 503 covers both a provider
 * outage and a broken configuration. Anything unrecognised falls through to the
 * status mapping rather than being guessed at.
 */
const CAPTCHA_CODES: Record<string, LoginErrorCode> = {
  CAPTCHA_FAILED: "captcha_failed",
  CAPTCHA_UNAVAILABLE: "captcha_unavailable",
  CAPTCHA_CONFIGURATION_ERROR: "captcha_configuration_error",
};

function mapLoginFailure(httpStatus: number, body: unknown): LoginErrorCode {
  const backendCode = backendErrorCode(body);
  if (backendCode !== null && backendCode in CAPTCHA_CODES) {
    return CAPTCHA_CODES[backendCode] as LoginErrorCode;
  }
  if (httpStatus === 400) return "invalid_input";
  if (httpStatus === 401) return "invalid_credentials";
  if (httpStatus === 403) {
    return backendErrorCode(body) === "EMAIL_NOT_VERIFIED" ? "email_not_verified" : "inactive";
  }
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus >= 500) return "upstream_unavailable";
  // A 2xx that failed to yield a session cookie, or any unmapped status, is a
  // broken contract rather than a user error.
  return "server_error";
}

/**
 * POST /api/crm/auth/login
 *
 * The CRM's only credential entry point. It forwards the submission to the
 * backend's `POST /api/auth/login`, and on success bridges the backend session
 * cookie onto the CRM origin.
 *
 * The backend stays the sole authentication authority: the CRM verifies no
 * password, mints no token of its own, and stores no identity. It also never
 * returns the backend's user payload — that body carries `email`, `level` and
 * `xp`, and the client's identity source is `GET /api/crm/v1/session` alone.
 *
 * ## The non-staff decision
 *
 * The backend authenticates learners perfectly well, so a learner submitting
 * valid credentials here gets a 200 and a session cookie from the backend. We
 * deliberately do **not** pass that cookie on. After a successful backend
 * authentication the route makes one server-side call to
 * `GET /api/crm/v1/session` with the fresh cookie; unless that answers 200, the
 * cookie is dropped and the caller gets `not_staff`.
 *
 * The effect is that no CRM-origin session ever exists for a non-staff account.
 * The alternative — bridge the cookie and let the session boundary render "no
 * access" — would leave a live staff-origin session belonging to someone with no
 * business holding one, which is a strictly worse resting state for an internal
 * tool. Note this does not touch the account's sessions elsewhere: the cookie is
 * never delivered to the browser, so nothing the learner already had changes.
 *
 * CSRF is not required here, matching the backend: `POST /api/auth/login` runs no
 * `validateCsrfToken`, because a login request carries no ambient authority to
 * abuse. Logout does require it, and does send it.
 */
export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return noStoreJson({ code: "invalid_input" satisfies LoginErrorCode }, 400);
  }

  const parsed = LoginRequestSchema.safeParse(raw);
  if (!parsed.success) {
    // Deliberately no zod issue list: the field-level detail is reconstructed by
    // the client from its own identical bounds, and echoing a parse error of a
    // body that contains a password is not worth the convenience.
    return noStoreJson({ code: "invalid_input" satisfies LoginErrorCode }, 400);
  }

  const result = await callBackend({
    path: BACKEND_PATHS.login,
    method: "POST",
    json: {
      email: parsed.data.email,
      password: parsed.data.password,
      // AFD-3A3. Forwarded only when present: an absent token is a REFUSAL at
      // the backend wherever login verification is enforced, never a bypass.
      ...(parsed.data.captchaToken ? { captchaToken: parsed.data.captchaToken } : {}),
    },
    // A CONSTANT, so a caller cannot declare a surface whose action pin it
    // would rather be judged against.
    authSurface: CRM_LOGIN_SURFACE,
    // The ingress-measured address, so staff logins do not all share one
    // backend rate-limit bucket. `null` when no trustworthy value exists — we
    // forward nothing rather than inventing one.
    clientIp: deriveTrustedClientIp(request),
  });

  if (result.status === "misconfigured") {
    return noStoreJson({ code: "server_error" satisfies LoginErrorCode }, 500);
  }
  if (result.status === "unreachable") {
    return noStoreJson({ code: "upstream_unavailable" satisfies LoginErrorCode }, 503);
  }

  const sessionCookie = result.cookies.find((cookie) => cookie.name === SESSION_COOKIE_NAME);

  if (result.httpStatus !== 200 || !sessionCookie || sessionCookie.value === "") {
    const code = mapLoginFailure(result.httpStatus, result.body);
    const requestId = safeRequestId(result.body);
    // Preserve the backend's status where it is meaningful to the client, but
    // never below 400 — a failure must not arrive looking like a success.
    const status = result.httpStatus >= 400 && result.httpStatus < 600 ? result.httpStatus : 502;
    return noStoreJson({ code, ...(requestId ? { requestId } : {}) }, status);
  }

  // Authenticated. Now decide whether this account is staff at all, using the
  // backend's own answer and the cookie we have not yet handed over.
  const staffCheck = await callBackend({
    path: BACKEND_PATHS.session,
    method: "GET",
    cookie: `${sessionCookie.name}=${sessionCookie.value}`,
  });

  if (staffCheck.status !== "responded") {
    return noStoreJson({ code: "upstream_unavailable" satisfies LoginErrorCode }, 503);
  }
  if (staffCheck.httpStatus !== 200) {
    // 403 (no StaffProfile) and 401 (account unusable) both land here. The
    // session cookie is discarded rather than bridged.
    const code: LoginErrorCode = staffCheck.httpStatus === 403 ? "not_staff" : "invalid_credentials";
    return noStoreJson(
      { code, ...(safeRequestId(staffCheck.body) ? { requestId: safeRequestId(staffCheck.body) } : {}) },
      403,
    );
  }

  // Staff confirmed. Bridge every allowlisted cookie the backend set — the
  // session cookie, plus a CSRF cookie if login happened to refresh one.
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  return applyBridgedCookies(response, result.cookies);
}
