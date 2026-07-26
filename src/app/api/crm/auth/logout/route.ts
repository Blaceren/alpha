import { NextResponse } from "next/server";
import { CSRF_HEADER_NAME } from "@/data/contracts/api/auth";
import { BACKEND_PATHS, callBackend } from "@/server/backend-client";
import { applyBridgedCookies, noStoreJson } from "@/server/auth-response";
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  clearedCookie,
} from "@/server/set-cookie-bridge";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/crm/auth/logout
 *
 * Forwards `POST /api/auth/logout`, including the caller's cookies and the
 * double-submit CSRF header the backend requires on this route.
 *
 * ## What logout can and cannot guarantee
 *
 * The backend session is a stateless HMAC-signed token: `userId.role.expiresAt`
 * plus a signature, with no server-side session row. Logout therefore *clears the
 * cookie*; it does not revoke a stored session, because there is nothing stored
 * to revoke. A token captured before logout stays cryptographically valid until
 * its own expiry. That is a property of the existing backend contract, not
 * something the CRM can fix from this side, and it is recorded plainly in the
 * phase audit rather than papered over here.
 *
 * What the CRM *can* guarantee is that the browser no longer holds the cookie,
 * so the CRM origin has no ambient authority afterwards.
 *
 * ## Why the cookies are cleared even when the backend call fails
 *
 * If the backend is unreachable or rejects the CSRF token, the safe outcome is
 * still "this browser is signed out of the CRM". Leaving a live session cookie in
 * place because a network call failed would turn a transient outage into a
 * session the employee believes they ended. So the clear-cookie response is
 * unconditional, and the backend status is reported separately.
 */
export async function POST(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  const csrfToken = request.headers.get(CSRF_HEADER_NAME);

  const result = await callBackend({
    path: BACKEND_PATHS.logout,
    method: "POST",
    cookie: cookieHeader,
    csrfToken,
    json: {},
  });

  // Whatever happened upstream, this browser leaves without CRM cookies.
  const cleared = [clearedCookie(SESSION_COOKIE_NAME), clearedCookie(CSRF_COOKIE_NAME)];

  if (result.status !== "responded") {
    const response = noStoreJson({ ok: true, upstream: "unavailable" }, 200);
    return applyBridgedCookies(response, cleared);
  }

  // The backend's own clear-cookie headers are bridged first, then our explicit
  // clears are applied. Both target the same names with the same flags, so the
  // result is one deletion per cookie rather than a conflicting pair.
  const response = NextResponse.json(
    { ok: true, ...(result.httpStatus === 200 ? {} : { upstream: "rejected" }) },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
  applyBridgedCookies(response, result.cookies);
  return applyBridgedCookies(response, cleared);
}
