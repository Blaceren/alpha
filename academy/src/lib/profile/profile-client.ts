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
