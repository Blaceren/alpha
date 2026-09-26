/**
 * CRM_BACKEND_ORIGIN validation.
 *
 * The origin is server-only: it is used to build exactly one Next rewrite
 * destination and is never sent to the browser. The browser only ever calls the
 * relative path `/api/crm/v1/session`.
 *
 * Validation is strict and fail-closed because a permissive origin is what turns
 * a same-origin proxy into an open one. `next.config.mjs` mirrors these rules in
 * plain JS (it cannot import TypeScript); the two are kept deliberately identical
 * and this module is the documented source of truth.
 */

export type BackendOriginError =
  | "missing"
  | "not_absolute"
  | "unsupported_protocol"
  | "has_credentials"
  | "has_query"
  | "has_hash"
  | "has_path";

export type BackendOriginResult =
  | { ok: true; origin: string }
  | { ok: false; error: BackendOriginError };

/**
 * Parse and normalize an absolute http(s) origin with no credentials, query,
 * hash or path. Returns the origin with no trailing slash, so callers can
 * concatenate an absolute path without producing a double slash.
 */
export function parseBackendOrigin(raw: string | undefined | null): BackendOriginResult {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, error: "missing" };

  const value = raw.trim();

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Relative values and malformed ports both land here: `new URL` needs an
    // absolute, well-formed input.
    return { ok: false, error: "not_absolute" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "unsupported_protocol" };
  }
  if (url.username !== "" || url.password !== "") return { ok: false, error: "has_credentials" };
  if (url.search !== "") return { ok: false, error: "has_query" };
  if (url.hash !== "") return { ok: false, error: "has_hash" };
  // `new URL("http://h")` yields pathname "/", which is the only path accepted.
  if (url.pathname !== "/") return { ok: false, error: "has_path" };

  // url.origin drops the trailing slash for http(s) — normalization is exactly
  // the "one safe trailing slash" rule.
  return { ok: true, origin: url.origin };
}

export function backendOriginErrorMessage(error: BackendOriginError): string {
  switch (error) {
    case "missing":
      return "CRM_BACKEND_ORIGIN is required when CRM_MODE=api.";
    case "not_absolute":
      return "CRM_BACKEND_ORIGIN must be an absolute URL, e.g. http://127.0.0.1:3110.";
    case "unsupported_protocol":
      return "CRM_BACKEND_ORIGIN must use http: or https:.";
    case "has_credentials":
      return "CRM_BACKEND_ORIGIN must not contain username/password credentials.";
    case "has_query":
      return "CRM_BACKEND_ORIGIN must not contain a query string.";
    case "has_hash":
      return "CRM_BACKEND_ORIGIN must not contain a hash fragment.";
    case "has_path":
      return "CRM_BACKEND_ORIGIN must be a bare origin with no path.";
  }
}
