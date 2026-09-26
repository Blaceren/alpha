/**
 * SERVER-ONLY: the public Turnstile site key (AFD-3A3).
 *
 * ## Why this is not `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
 *
 * A `NEXT_PUBLIC_` variable is INLINED AT BUILD TIME. That would pin every
 * deployment of a given build to one Cloudflare widget, make rotating the widget
 * a release rather than a restart, and make the DEV and production builds
 * different artifacts. The CRM already resolves `CRM_MODE` this way — read on the
 * server, passed down as a prop — and the site key follows the same contract for
 * the same reasons.
 *
 * The key is public: it appears in the page source of every site that uses one.
 * That is why it may be handed to the browser at all. The SECRET counterpart is
 * a backend credential, is never present in this package's environment, and is
 * not read here or anywhere else in the CRM.
 *
 * ## Absent is unavailable, never open
 *
 * A missing key yields `null`, which the login form renders as an unavailable
 * state with submission blocked. It does NOT fall back to a legacy unchallenged
 * login: the backend would refuse such a request with a configuration error
 * anyway, and offering a form that cannot succeed is worse than saying so.
 */

/** The environment key name. Exported so tests and the operator handoff agree. */
export const TURNSTILE_SITE_KEY_ENV = "TURNSTILE_SITE_KEY";

/**
 * Read the site key from an environment-like record.
 *
 * Exported separately from `getTurnstileSiteKey` so tests can drive it without
 * mutating `process.env`, matching `resolveServerRuntimeConfig`.
 */
export function resolveTurnstileSiteKey(
  source: Record<string, string | undefined>,
): string | null {
  const raw = source[TURNSTILE_SITE_KEY_ENV];
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** Read the site key from the real process environment. */
export function getTurnstileSiteKey(): string | null {
  return resolveTurnstileSiteKey(process.env as Record<string, string | undefined>);
}
