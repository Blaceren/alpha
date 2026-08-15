/**
 * AFFILIATE-PLATFORM-V1 §31 — the console's only way to reach the Backend.
 *
 * RELATIVE PATHS ONLY. The Backend origin lives in the Next rewrite
 * configuration and is server-only, so the browser never learns it and cannot
 * be pointed at another one.
 *
 * THE CSRF TOKEN IS ECHOED FROM THE COOKIE ON EVERY MUTATION. The session
 * cookie is SameSite=Strict, so a cross-site request arrives with no session at
 * all; this double-submit is the second layer, matching the learner surface's
 * accepted construction.
 */
export const CSRF_COOKIE = "__Host-ata_partner_csrf";
export const CSRF_HEADER = "x-partner-csrf-token";

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  for (const raw of document.cookie.split(";")) {
    const item = raw.trim();
    if (item.startsWith(`${CSRF_COOKIE}=`)) {
      return decodeURIComponent(item.slice(CSRF_COOKIE.length + 1));
    }
  }
  return null;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; messageKey: string };

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") {
    const token = readCsrfCookie();
    if (token !== null) headers[CSRF_HEADER] = token;
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    return { ok: false, status: 0, code: "network", messageKey: "partner.network.unreachable" };
  }

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text === "" ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const body = (parsed ?? {}) as { error?: string; messageKey?: string };
    return {
      ok: false,
      status: response.status,
      code: body.error ?? "unknown",
      messageKey: body.messageKey ?? "partner.error.unknown",
    };
  }
  return { ok: true, data: parsed as T };
}

/**
 * Render a message key as text a partner can read.
 *
 * A CLOSED MAP WITH A TRUTHFUL FALLBACK. An unmapped key renders as the key
 * itself rather than as a friendly invention, so a missing translation is
 * visible rather than silently replaced by a reassuring sentence that may be
 * wrong.
 */
const MESSAGES: Record<string, string> = {
  "partner.session.unauthenticated": "Your session has ended. Please sign in again.",
  "partner.session.refused": "Those credentials were not accepted.",
  "partner.session.rate_limited": "Too many attempts. Please wait and try again.",
  "partner.session.partner_not_active": "This affiliate account is not currently active.",
  "partner.platform.unavailable": "The partner platform is not available.",
  "partner.csrf.invalid": "Your session could not be verified. Please reload and try again.",
  "partner.network.unreachable": "Could not reach the server.",
  "partner.links.unknown_campaign": "That campaign is not available to you.",
  "partner.account.reauth_failed": "Your current password was not accepted.",
  "partner.account.password.too_short": "Password is too short.",
  "partner.account.password.low_variety": "Password needs more distinct characters.",
  "partner.account.password.contains_email": "Password must not contain your address.",
};

export function messageFor(key: string): string {
  return MESSAGES[key] ?? key;
}
