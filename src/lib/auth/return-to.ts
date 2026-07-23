/**
 * Redirect-target validation.
 *
 * After login the user is returned to the internal route they originally
 * requested. That target arrives as untrusted input (a query param). We accept
 * ONLY an internal, same-origin relative path and reject everything an open
 * redirect would exploit.
 */

export const DEFAULT_RETURN_TO = "/";

/** The login route itself — never a valid return target (would loop). */
const LOGIN_PATH = "/login";

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    // C0 controls (incl. NUL/tab/newline), raw space, and DEL. A legitimate
    // internal path never contains these unencoded.
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function sanitizeReturnTo(raw: string | null | undefined): string {
  if (raw == null) return DEFAULT_RETURN_TO;

  const value = raw;

  // Reject control characters (incl. NUL, tab, newline) used to smuggle schemes.
  if (hasControlChar(value)) return DEFAULT_RETURN_TO;

  // Must be a rooted path.
  if (!value.startsWith("/")) return DEFAULT_RETURN_TO;

  // Reject protocol-relative ("//host") and backslash tricks ("/\\host").
  if (value.startsWith("//")) return DEFAULT_RETURN_TO;
  if (value.includes("\\")) return DEFAULT_RETURN_TO;

  // Defence in depth: a rooted path can never contain a scheme, but reject any
  // "scheme:" prefix regardless.
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(value)) return DEFAULT_RETURN_TO;

  // Reject a return target that points back at /login (recursive loop).
  const pathOnly = value.split(/[?#]/, 1)[0] ?? value;
  if (pathOnly === LOGIN_PATH || pathOnly.startsWith(`${LOGIN_PATH}/`)) {
    return DEFAULT_RETURN_TO;
  }

  return value;
}
