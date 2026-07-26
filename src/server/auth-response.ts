/**
 * SERVER-ONLY response helpers for the CRM auth route handlers.
 *
 * Auth responses must never be cached — not by the browser, not by a proxy, not
 * by Next. A cached login response would hand one employee's `Set-Cookie` to the
 * next visitor, and a cached CSRF token would defeat double-submit. Every helper
 * here therefore sets `no-store` unconditionally rather than leaving it to the
 * caller to remember.
 */
import { NextResponse } from "next/server";
import type { BridgedCookie } from "@/server/set-cookie-bridge";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** A JSON response that is never stored anywhere. */
export function noStoreJson(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Attach bridged cookies to a response.
 *
 * The typed descriptor is handed to Next's cookie serializer rather than being
 * re-joined into a header string by hand. That is the whole point: `Expires`
 * contains a comma, and string-splicing it is how expiry dates get corrupted
 * into session cookies or immediate deletions.
 *
 * `expires` and `maxAge` are both forwarded when the backend sent both. They
 * agree by construction (the backend derives them from one value), and browsers
 * prefer `Max-Age`, so passing both is the faithful reflection rather than a
 * choice between them.
 */
export function applyBridgedCookies(
  response: NextResponse,
  cookies: readonly BridgedCookie[],
): NextResponse {
  for (const cookie of cookies) {
    response.cookies.set({
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      secure: cookie.secure,
      ...(cookie.maxAge !== undefined ? { maxAge: cookie.maxAge } : {}),
      ...(cookie.expires !== undefined ? { expires: cookie.expires } : {}),
    });
  }
  return response;
}
