/**
 * Redirect-target validation.
 *
 * After login the user is returned to the internal route they originally
 * requested. That target arrives as untrusted input (a query param). We accept
 * ONLY an internal, same-origin relative path and reject everything an open
 * redirect would exploit.
 */

/**
 * Where a successful LOGIN lands when the request carried no valid internal
 * return path.
 *
 * UNIFIED-DESIGN-V1 changed this from `/` to `/home`. `/` is now the Public
 * Home, which is a marketing surface: sending a learner who just authenticated
 * to a page whose job is to persuade them to sign up would be a regression.
 * `/home` is the same Authenticated Home component this constant always
 * resolved to — only its path moved.
 *
 * This is a FALLBACK, never an override: `sanitizeReturnTo` returns the user's
 * validated original destination whenever one exists, exactly as before.
 */
export const DEFAULT_RETURN_TO = "/home";

/**
 * Where a successful REGISTRATION lands, when the Backend created a session.
 *
 * DELIBERATELY A SEPARATE CONSTANT FROM `DEFAULT_RETURN_TO`, even though the two
 * currently share a value. Before this change both flows read one constant, so
 * moving the login destination would have silently moved the registration
 * destination too — and the post-registration/onboarding/L1 flow is a product
 * decision that must not move as a side effect of an unrelated routing change.
 * Splitting them makes that coupling impossible to reintroduce by accident, and
 * gives the onboarding destination one obvious place to change if it is ever
 * routed somewhere more specific than the Academy home.
 */
export const POST_REGISTRATION_RETURN_TO = "/home";

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
