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
 * The session cookie to forward, under the name it actually arrived as.
 *
 * Returns null when neither name is present, which the callers treat as "no
 * session" — the same answer they gave before. The name is returned with the
 * value because the Backend is told which cookie it is receiving; forwarding a
 * legacy value under the new name would be a small lie that the Backend would
 * then have to unpick.
 */
export function sessionCookieToForward(
  read: (name: string) => { value: string } | undefined,
): { name: string; value: string } | null {
  const current = read(SESSION_COOKIE_NAME);
  if (current) return { name: SESSION_COOKIE_NAME, value: current.value };
  const legacy = read(LEGACY_SESSION_COOKIE_NAME);
  if (legacy) return { name: LEGACY_SESSION_COOKIE_NAME, value: legacy.value };
  return null;
}
