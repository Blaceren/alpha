/**
 * AFD-3B2 — the attribution cookie contract.
 *
 * THE NAME IS PART OF THE SECURITY. `__Host-` is not decoration: a browser will
 * only store a cookie under that prefix if it is Secure, has Path=/ and has NO
 * Domain attribute. That last one is the point. Without it, any sibling
 * subdomain — including one an attacker gets control of — could set a cookie
 * that our origin would then read as a legitimate visitor journey. With it, only
 * this exact host can write it.
 *
 * SECURE IS UNCONDITIONAL. Unlike the session cookie, whose `secure` flag is
 * derived from APP_URL, this one is always Secure. A cookie named `__Host-` that
 * is not Secure is not stored by any modern browser at all, so making it
 * conditional would produce a flag that silently does nothing on plaintext and a
 * cookie that silently never exists. Fail visibly instead: attribution over
 * plaintext is not supported, and the isolated regression suites exercise the
 * contract through a scripted client rather than by weakening it.
 *
 * SAMESITE=LAX, NOT STRICT. The visitor arrives at `/go` from the affiliate's
 * own site — a cross-site top-level navigation. Strict would refuse to send the
 * cookie on the very hop that matters, and `None` would send it on every
 * embedded third-party request. Lax is the only value that describes what this
 * cookie is for.
 */
export const ATTRIBUTION_COOKIE_NAME = "__Host-ata_attribution";

/**
 * The header name a browser must never be able to use to inject an attribution
 * decision. `/go` and the registration owner both strip it from incoming
 * requests. It exists as a named constant only so the strip is greppable — no
 * code path ever SETS it, because an unsigned internal header would be exactly
 * the client-supplied affiliate identity this design refuses to have.
 */
export const FORBIDDEN_INBOUND_ATTRIBUTION_HEADERS: readonly string[] = [
  "x-ata-attribution",
  "x-ata-attribution-token",
  "x-ata-visitor-id",
  "x-ata-click-id",
  "x-ata-affiliate",
];

export type AttributionCookieOptions = {
  readonly httpOnly: true;
  readonly secure: true;
  readonly sameSite: "lax";
  readonly path: "/";
  readonly maxAge: number;
};

/**
 * Options for issuing the cookie. `maxAge` is bounded by the caller, which
 * derives it from the token's own expiry — the cookie and the token must never
 * disagree about when the journey ends.
 *
 * There is deliberately no `domain` key. Adding one would make the browser
 * refuse the `__Host-` name outright, which is the desired failure mode, but
 * omitting it entirely means nobody can add one by editing a value.
 */
export function attributionCookieOptions(maxAgeSeconds: number): AttributionCookieOptions {
  const maxAge = Math.max(0, Math.floor(maxAgeSeconds));
  return { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge };
}

/**
 * Options for clearing the cookie after a successful registration.
 *
 * Max-Age=0 with the SAME attributes, because a browser matches a deletion to
 * an existing cookie by name, path and domain: clearing with a different Path
 * would leave the original in place while appearing to succeed.
 */
export function clearedAttributionCookieOptions(): AttributionCookieOptions {
  return attributionCookieOptions(0);
}

/**
 * Read the token out of a raw Cookie header.
 *
 * Hand-parsed rather than taken from a framework helper because this runs in
 * both a route handler and a proxy-facing owner, and because the rules here are
 * strict on purpose: a cookie repeated in one header is ambiguous — a browser
 * would send the most specific first, but an attacker can send whatever they
 * like — so a duplicate is treated as no cookie at all rather than as "first one
 * wins".
 */
export function readAttributionCookie(cookieHeader: string | null | undefined): string | null {
  if (typeof cookieHeader !== "string" || cookieHeader === "") return null;
  // A pathological Cookie header is not parsed at all.
  if (cookieHeader.length > 8192) return null;

  const found: string[] = [];
  for (const segment of cookieHeader.split(";")) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    const name = segment.slice(0, separator).trim();
    if (name !== ATTRIBUTION_COOKIE_NAME) continue;
    found.push(segment.slice(separator + 1).trim());
  }

  if (found.length !== 1) return null;
  return found[0] === "" ? null : found[0];
}
