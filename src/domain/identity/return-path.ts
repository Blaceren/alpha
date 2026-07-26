/**
 * Where to send an employee after a successful login.
 *
 * ## Why this is not a query parameter
 *
 * `LOGIN_REDIRECT` is the fixed literal `/login?reason=session_required`, and
 * `session-boundary.test.tsx` asserts it carries no `returnTo|next|redirect|url`
 * parameter. That is a deliberate anti-open-redirect decision: a redirect target
 * in the URL is a target an attacker can put in a link they send to staff.
 *
 * So the intended path is remembered in `sessionStorage` instead — written by the
 * code that performs the redirect, not by whoever crafted the URL. It is a path,
 * not a credential: no token, no identity, nothing that grants access. It dies
 * with the tab.
 *
 * Both the write and the read validate, because a value that survived in storage
 * from an older build is still untrusted input.
 */

export const RETURN_PATH_KEY = "ata_crm_return_path";

/** Where staff land when there is no remembered path. */
export const DEFAULT_LANDING_PATH = "/users";

const MAX_LENGTH = 512;

/**
 * True when the string contains a C0 control character or DEL.
 *
 * Written as an explicit codepoint scan rather than a regex with literal control
 * characters: those literals are invisible in a diff and easy for tooling to
 * corrupt silently, and a corrupted character class here would either reject
 * every path or accept a CR/LF header-injection attempt.
 */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Accept only a same-origin absolute path.
 *
 * Rejected, and why each matters:
 *
 * - anything not starting with `/` — a bare `evil.com` is a relative path that
 *   some routers will happily turn into an absolute one
 * - `//host` and `/\host` — protocol-relative URLs; browsers read both as
 *   another origin, and the backslash form is the one people forget
 * - any `:` before the first `/` boundary, and any control character
 * - `/login` itself — returning to the login page after logging in is the
 *   redirect loop this guard exists to prevent
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();

  if (value === "" || value.length > MAX_LENGTH) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (hasControlCharacter(value)) return null;
  if (value.includes("\\")) return null;

  // A scheme can only appear before the first slash of a real path; since we
  // already know the string starts with "/", any colon in the first segment is
  // malformed rather than meaningful.
  const firstSegment = value.slice(1).split("/")[0] ?? "";
  if (firstSegment.includes(":")) return null;

  const pathOnly = value.split(/[?#]/)[0] ?? value;
  if (pathOnly === "/login") return null;

  return value;
}

/**
 * Remember where the employee was heading. Silent no-op when storage is
 * unavailable (private mode, disabled storage) — losing the return path is a
 * minor inconvenience, and throwing here would break the redirect itself.
 */
export function rememberReturnPath(path: unknown): void {
  const safe = safeReturnPath(path);
  if (!safe) return;
  try {
    window.sessionStorage.setItem(RETURN_PATH_KEY, safe);
  } catch {
    /* storage unavailable — fall back to the default landing path */
  }
}

/**
 * Read and clear the remembered path. Always consumed, so a stale entry cannot
 * hijack a later, unrelated login in the same tab.
 */
export function consumeReturnPath(): string {
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(RETURN_PATH_KEY);
    window.sessionStorage.removeItem(RETURN_PATH_KEY);
  } catch {
    stored = null;
  }
  return safeReturnPath(stored) ?? DEFAULT_LANDING_PATH;
}
