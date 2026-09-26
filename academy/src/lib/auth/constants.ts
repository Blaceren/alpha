/**
 * Shared auth constants (safe for both server and client bundles).
 * The session cookie is httpOnly — this name is used only for presence checks
 * in the middleware/guard and for forwarding, never to read the token value.
 */
/**
 * The Backend's learner session cookie, which the Academy forwards and never
 * interprets.
 *
 * H-7 moved the session server-side and renamed the cookie to carry the
 * `__Host-` prefix. The Academy holds both names for one reason: cutover order.
 * The Academy and the Backend are separate releases, and whichever goes first,
 * a browser will arrive for a while holding the other name. Reading both means
 * neither order produces a redirect loop.
 *
 * THIS IS NOT DUAL TOKEN ACCEPTANCE. The Academy does not verify anything — it
 * forwards the cookie it has and the Backend decides. A legacy cookie is
 * forwarded, rejected by the Backend, and the learner is asked to sign in
 * again, which is exactly the forced re-login this change accepts.
 */
export const SESSION_COOKIE_NAME = "__Host-trading_platform_session";

/** The pre-H-7 name. Forwarded if present; never trusted, never verified. */
export const LEGACY_SESSION_COOKIE_NAME = "trading_platform_session";

/** Header set by middleware so the server guard knows the requested path. */
export const PATHNAME_HEADER = "x-academy-pathname";

/**
 * Every session cookie the browser sent, as a `Cookie` header value.
 *
 * FORWARD BOTH WHEN BOTH ARE THERE. An earlier version of this chose one — the
 * new name if present, otherwise the legacy one — and that choice is what made
 * the cutover order fragile. A Backend that reads only `trading_platform_session`
 * and a Backend that reads only `__Host-…` cannot both be satisfied by a single
 * forwarded cookie, so during the window when either might be active, the
 * honest thing is to send everything the browser has and let the Backend pick
 * the one it understands.
 *
 *   legacy only  ->  legacy
 *   new only     ->  new
 *   both         ->  both, each under its own name
 *   neither      ->  null, which every caller treats as "no session"
 *
 * Names are preserved exactly. Forwarding a legacy value under the new name
 * would be a small lie the Backend would then have to unpick.
 *
 * THE ACADEMY STILL VERIFIES NOTHING. This is transport. The Backend is the
 * only authority on whether any of these means anything.
 */
export function sessionCookieHeader(
  read: (name: string) => { value: string } | undefined,
): string | null {
  const parts: string[] = [];
  for (const name of [SESSION_COOKIE_NAME, LEGACY_SESSION_COOKIE_NAME]) {
    const cookie = read(name);
    if (cookie) parts.push(`${name}=${cookie.value}`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

/** True when the browser sent either session cookie. Routing hint only. */
export function hasAnySessionCookie(has: (name: string) => boolean): boolean {
  return has(SESSION_COOKIE_NAME) || has(LEGACY_SESSION_COOKIE_NAME);
}
