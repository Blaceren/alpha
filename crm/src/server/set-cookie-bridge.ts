/**
 * SERVER-ONLY: the cookie bridge.
 *
 * The backend owns authentication, so the backend is the only thing that may
 * mint a staff session. Its `Set-Cookie` therefore has to reach the browser —
 * but it must reach it as a cookie for the CRM's OWN origin, and it must not be
 * able to smuggle anything else along the way. This module is that boundary.
 *
 * What it does, and why each rule exists:
 *
 * - **Name allowlist.** Only the reviewed cookies are bridged: the session
 *   cookie, the CSRF cookie, and the pre-H-7 session name — the last one ONLY
 *   as a deletion (see LEGACY_SESSION_COOKIE_NAME). A backend that started
 *   setting anything else — an analytics id, a second session, a cookie named to
 *   shadow a CRM one — would be silently dropped rather than trusted. An
 *   allowlist is the only version of this that stays correct as the backend
 *   evolves.
 *
 * - **The session cookie name is the backend's, exactly.** Backend H-7 renamed
 *   the session to `__Host-trading_platform_session` and stopped reading the old
 *   name. The CRM kept looking for the old one, so every correct staff login
 *   ended in a 502 and no CRM session could exist. The name here must track
 *   `SESSION_COOKIE_NAME` in the backend's `src/lib/session.ts`.
 *
 * - **`__Host-` cookies are always Secure.** A browser refuses to store a
 *   `__Host-` cookie that is not Secure, so for that prefix the flag is not a
 *   policy choice — see `requiresSecure`.
 *
 * - **Domain is always dropped.** A `Domain` attribute from the backend is
 *   meaningless-to-hostile here: at best it names the backend host (so the
 *   browser would reject the cookie for the CRM origin), at worst it widens the
 *   cookie to a parent domain the CRM does not own. Dropping it is what makes
 *   the result host-only for the CRM origin, which is exactly the documented
 *   session boundary.
 *
 * - **Path is normalized to "/".** Both bridged cookies must be visible to the
 *   whole CRM app (page routes and `/api/crm/*` alike). A narrower backend Path
 *   would silently break the app rather than fail loudly.
 *
 * - **`Secure` is recomputed, never copied.** See config/cookie-security.ts —
 *   except for `__Host-` cookies, where it is always set (above).
 *
 * - **`HttpOnly` and `SameSite` are preserved as sent.** These are real security
 *   decisions the backend already made correctly: the session cookie is
 *   HttpOnly (so no script can read it) and the CSRF cookie deliberately is not
 *   (double-submit requires the client to read it). Overriding either would
 *   break one of the two.
 *
 * - **Expiry is preserved structurally, not by string surgery.** `Max-Age` and
 *   `Expires` are parsed into typed values and handed to Next's cookie
 *   serializer. Re-emitting a hand-spliced string is how `Expires` dates — which
 *   contain a comma — get corrupted into a session cookie or an immediate
 *   expiry.
 *
 * Parsing is done here rather than with a cookie library because no dependency
 * may be added in this phase, and because the set of attributes we accept is
 * deliberately smaller than the spec.
 */
import { shouldUseSecureCookies } from "@/config/cookie-security";

/**
 * The backend session cookie. HttpOnly; the browser never reads it in script.
 * Must equal the backend's `SESSION_COOKIE_NAME` (`src/lib/session.ts`).
 */
export const SESSION_COOKIE_NAME = "__Host-trading_platform_session";

/**
 * The session name the backend used before H-7.
 *
 * The backend never issues a session under it any more; on login and logout it
 * sends it back EMPTY with `Max-Age=0`, to expire whatever an old browser still
 * holds. It is bridged for exactly that purpose, and a non-empty value under this
 * name is dropped — this bridge must never deliver a session the backend no
 * longer accepts.
 */
export const LEGACY_SESSION_COOKIE_NAME = "trading_platform_session";

/**
 * The backend CSRF cookie. Deliberately readable by script — the double-submit
 * scheme requires the client to echo it in a header.
 */
export const CSRF_COOKIE_NAME = "trading_platform_csrf";

/** Exactly the cookies reviewed for bridging (the legacy name as a deletion only). */
export const BRIDGED_COOKIE_NAMES = [
  SESSION_COOKIE_NAME,
  LEGACY_SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
] as const;

export type BridgedCookieName = (typeof BRIDGED_COOKIE_NAMES)[number];

export interface BridgedCookie {
  name: BridgedCookieName;
  value: string;
  path: "/";
  httpOnly: boolean;
  sameSite: "lax" | "strict" | "none";
  secure: boolean;
  /** Seconds. Present only when the backend sent `Max-Age`. `0` clears. */
  maxAge?: number;
  /** Present only when the backend sent a parseable `Expires`. */
  expires?: Date;
}

function isBridgedName(name: string): name is BridgedCookieName {
  return (BRIDGED_COOKIE_NAMES as readonly string[]).includes(name);
}

/**
 * `__Host-` cookies are stored by a browser only when Secure, so for them the
 * flag is forced. Everything else follows the CRM's deployment rule.
 */
function requiresSecure(name: BridgedCookieName, env?: Record<string, string | undefined>): boolean {
  return name.startsWith("__Host-") || shouldUseSecureCookies(env);
}

function parseSameSite(raw: string | undefined): "lax" | "strict" | "none" {
  switch (raw?.trim().toLowerCase()) {
    case "strict":
      return "strict";
    case "none":
      return "none";
    case "lax":
      return "lax";
    default:
      // An absent or unrecognised SameSite becomes "lax". That matches what the
      // backend sends today and what browsers default to, and it is the
      // conservative choice: never silently widen to "none".
      return "lax";
  }
}

/**
 * Parse one `Set-Cookie` header value into a normalized, CRM-owned cookie.
 * Returns null when the cookie is not on the allowlist or is unparseable —
 * callers drop it rather than guessing.
 *
 * Only the first `=` is treated as the name/value separator, because cookie
 * values (a signed session token, for instance) legitimately contain `=`.
 */
export function parseBridgedSetCookie(
  raw: string,
  env?: Record<string, string | undefined>,
): BridgedCookie | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;

  const segments = raw.split(";");
  const pair = segments[0] ?? "";
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;

  const name = pair.slice(0, eq).trim();
  if (!isBridgedName(name)) return null;

  // An empty value is valid and meaningful: it is how logout clears the cookie.
  const value = pair.slice(eq + 1).trim();

  // The legacy session name is only ever bridged as a deletion.
  if (name === LEGACY_SESSION_COOKIE_NAME && value !== "") return null;

  const attributes = new Map<string, string | undefined>();
  for (const segment of segments.slice(1)) {
    const trimmed = segment.trim();
    if (trimmed === "") continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) {
      attributes.set(trimmed.toLowerCase(), undefined);
    } else {
      attributes.set(trimmed.slice(0, idx).trim().toLowerCase(), trimmed.slice(idx + 1).trim());
    }
  }

  const cookie: BridgedCookie = {
    name,
    value,
    // Normalized, not copied — see the module comment.
    path: "/",
    httpOnly: attributes.has("httponly"),
    sameSite: parseSameSite(attributes.get("samesite")),
    secure: requiresSecure(name, env),
  };

  const maxAgeRaw = attributes.get("max-age");
  if (maxAgeRaw !== undefined) {
    // The emptiness check has to come first: `Number("")` and `Number("  ")` are
    // both 0, and `Number.isInteger(0)` is true, so a malformed `Max-Age=` would
    // otherwise be read as "expire immediately" — silently destroying the very
    // session this bridge exists to deliver.
    const trimmed = maxAgeRaw.trim();
    if (trimmed !== "") {
      const parsed = Number(trimmed);
      if (Number.isInteger(parsed)) cookie.maxAge = parsed;
    }
  }

  const expiresRaw = attributes.get("expires");
  if (expiresRaw !== undefined) {
    const parsed = new Date(expiresRaw);
    if (!Number.isNaN(parsed.getTime())) cookie.expires = parsed;
  }

  return cookie;
}

/**
 * Bridge every `Set-Cookie` on a backend response.
 *
 * `Headers.getSetCookie()` is used rather than `headers.get("set-cookie")`
 * because a single `get` joins multiple cookies with ", " — and an `Expires`
 * date contains a comma, so splitting that string back apart is ambiguous by
 * construction. `getSetCookie()` returns the individual header lines, which is
 * what makes a login response that sets both the session and the CSRF cookie
 * survive intact.
 *
 * Order is preserved so that a backend which clears and then re-sets the same
 * cookie ends with the intended value.
 */
export function bridgeSetCookies(
  headers: Headers,
  env?: Record<string, string | undefined>,
): BridgedCookie[] {
  const raw: string[] =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : // Fallback for a Headers implementation without getSetCookie (older
        // test doubles). Single-cookie only; ambiguous multi-cookie strings are
        // exactly what we refuse to guess at.
        (() => {
          const single = headers.get("set-cookie");
          return single ? [single] : [];
        })();

  const bridged: BridgedCookie[] = [];
  for (const line of raw) {
    const cookie = parseBridgedSetCookie(line, env);
    if (cookie) bridged.push(cookie);
  }
  return bridged;
}

/** The descriptor used to actively clear a bridged cookie on the CRM origin. */
export function clearedCookie(
  name: BridgedCookieName,
  env?: Record<string, string | undefined>,
): BridgedCookie {
  return {
    name,
    value: "",
    path: "/",
    // Clearing repeats the flags the cookie was set with. For the `__Host-`
    // session that is not optional: a deletion that is not Secure, or carries a
    // Domain, is rejected by the browser and the live cookie survives.
    httpOnly: name === SESSION_COOKIE_NAME || name === LEGACY_SESSION_COOKIE_NAME,
    sameSite: name === SESSION_COOKIE_NAME ? "strict" : "lax",
    secure: requiresSecure(name, env),
    maxAge: 0,
  };
}
