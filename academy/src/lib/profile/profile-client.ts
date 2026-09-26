import { makeError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

/**
 * The one write this surface performs, and nothing else.
 *
 * It fetches a CSRF token first, exactly as every other write client in the
 * product does, then sends the single field. The caller gets back the SERVER'S
 * value on success — not the string it sent — because the server's value is
 * what becomes the learner's identity.
 */
const PROXY_BASE = "/api/backend";

export type SaveNameResult =
  | { ok: true; name: string }
  | { ok: false; error: NormalizedError };

/**
 * A password change has three outcomes, not two.
 *
 * `wrongCurrent` is separated from `error` because it is the only one the person
 * can act on: it names a value they typed, and the form keeps its other fields.
 * Collapsing it into a generic failure would make a typo look like an outage.
 */
export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; wrongCurrent: true }
  | { ok: false; wrongCurrent: false; error: NormalizedError };

async function csrfToken(signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(`${PROXY_BASE}/csrf`, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const token = (body as { csrfToken?: unknown })?.csrfToken;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export async function saveProfileName(name: string, signal?: AbortSignal): Promise<SaveNameResult> {
  const token = await csrfToken(signal);
  if (!token) return { ok: false, error: makeError("NETWORK_ERROR") };

  let response: Response;
  try {
    response = await fetch(`${PROXY_BASE}/profile/name`, {
      method: "PATCH",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-csrf-token": token,
      },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ name }),
      signal,
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR") };
  }

  const requestId = response.headers.get(REQUEST_ID_HEADER);
  if (!response.ok) {
    return { ok: false, error: makeError("BACKEND_UNAVAILABLE", { requestId }) };
  }

  let confirmed: unknown;
  try {
    confirmed = await response.json();
  } catch {
    return { ok: false, error: makeError("MALFORMED_RESPONSE", { requestId }) };
  }

  /* THE SERVER'S VALUE, OR NOTHING. A 200 whose body does not carry the name is
     not a confirmed save: the page would have to fall back to the draft, which
     is exactly the optimistic identity the design forbids. */
  const value = (confirmed as { user?: { name?: unknown } })?.user?.name;
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE", { requestId }) };
  }
  return { ok: true, name: value };
}

/**
 * THE PASSWORD NEVER TOUCHES ANYTHING BUT THIS REQUEST.
 *
 * No logging, no state, no retry buffer, no error object that carries it. The
 * two values arrive as arguments and leave as a request body; the caller clears
 * its fields the moment this resolves.
 */
export async function changeProfilePassword(
  currentPassword: string,
  newPassword: string,
  signal?: AbortSignal,
): Promise<ChangePasswordResult> {
  const token = await csrfToken(signal);
  if (!token) return { ok: false, wrongCurrent: false, error: makeError("NETWORK_ERROR") };

  let response: Response;
  try {
    response = await fetch(`${PROXY_BASE}/auth/change-password`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-csrf-token": token,
      },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ currentPassword, newPassword }),
      signal,
    });
  } catch {
    return { ok: false, wrongCurrent: false, error: makeError("NETWORK_ERROR") };
  }

  if (response.ok) return { ok: true };

  const requestId = response.headers.get(REQUEST_ID_HEADER);
  let code: unknown;
  try {
    code = ((await response.json()) as { error?: unknown })?.error;
  } catch {
    code = undefined;
  }
  if (response.status === 400 && code === "INVALID_CURRENT_PASSWORD") {
    return { ok: false, wrongCurrent: true };
  }
  return { ok: false, wrongCurrent: false, error: makeError("BACKEND_UNAVAILABLE", { requestId }) };
}
