/**
 * The Academy Pocket REFERRAL LINK client (browser).
 *
 * Component code never calls `fetch` directly. This targets the Academy
 * same-origin proxy (`/api/backend/*`), so the httpOnly session cookie is sent
 * by the browser and no token is handled in JS. The call is CSRF-protected
 * (double-submit) with a bootstrapped token, exactly like the level-start and
 * checkpoint clients.
 *
 * THE AFFILIATE URL IS NEVER IN THIS BUNDLE. The base URL, its tracking
 * parameters and the learner's clickid are all server-owned. This module asks
 * for a URL and receives one; it cannot construct, guess or influence it, and it
 * sends no request body at all.
 *
 * WHY THE RETURNED URL IS RE-VALIDATED HERE
 * Defense in depth, not distrust of one component. The value ends up in
 * `window.open`, so it is the one place a bad URL becomes a real navigation. A
 * `javascript:` or `data:` URL would be script execution in the learner's
 * session; a loopback or internal-port URL would be a dead link that looks like
 * a platform failure. The Backend already refuses all of these — this refuses
 * them again at the only point where they would matter.
 */
import {
  makeError,
  normalizeHttpError,
  REQUEST_ID_HEADER,
  type NormalizedError,
} from "@/lib/api/errors";
import { isBackendCsrfResponse } from "@/lib/api/types";

const PROXY_BASE = "/api/backend";
const MAX_RESPONSE_BYTES = 8 * 1024;

/** Hosts that would make the link dead for everyone but this machine. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", "[::]"]);
/** Internal service ports: Backend, Academy, CRM. */
const INTERNAL_SERVICE_PORTS = new Set(["3100", "3050", "3010"]);

export type ReferralLinkApiResult =
  | { ok: true; url: string; requestId: string | null }
  | { ok: false; error: NormalizedError };

async function readBoundedJson(
  response: Response,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return { ok: false };
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

async function fetchCsrfToken(signal?: AbortSignal): Promise<
  { ok: true; token: string } | { ok: false; error: NormalizedError }
> {
  let response: Response;
  try {
    response = await fetch(`${PROXY_BASE}/csrf`, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR") };
  }
  const requestId = response.headers.get(REQUEST_ID_HEADER);
  const parsed = await readBoundedJson(response);
  if (!response.ok) {
    return {
      ok: false,
      error: normalizeHttpError({
        status: response.status,
        body: parsed.ok ? parsed.value : undefined,
        requestId,
      }),
    };
  }
  if (!parsed.ok || !isBackendCsrfResponse(parsed.value)) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE", { status: response.status, requestId }) };
  }
  return { ok: true, token: parsed.value.csrfToken };
}

/**
 * True when this is a URL we are willing to hand to `window.open`.
 *
 * Exported so the contract is testable directly rather than only through a
 * rendered component.
 */
export function isSafeExternalReferralUrl(value: unknown): value is string {
  if (typeof value !== "string" || value === "") return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  // Only https. This also excludes `javascript:`, `data:`, `file:` and `blob:`,
  // which are the schemes that turn an opened link into script execution or a
  // local file read rather than a navigation.
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return false;
  if (url.port !== "" && INTERNAL_SERVICE_PORTS.has(url.port)) return false;
  return true;
}

function isReferralLinkEnvelope(value: unknown): value is { referralUrl: string } {
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as { referralUrl?: unknown }).referralUrl === "string";
}

/**
 * Ask the Backend for this learner's Pocket registration URL.
 *
 * Sends no body. The learner is identified by their session, and the clickid is
 * minted and owned server-side.
 */
export async function requestReferralLink(signal?: AbortSignal): Promise<ReferralLinkApiResult> {
  const csrf = await fetchCsrfToken(signal);
  if (!csrf.ok) return { ok: false, error: csrf.error };

  let response: Response;
  try {
    response = await fetch(`${PROXY_BASE}/exchange/referral-link`, {
      method: "POST",
      headers: { accept: "application/json", "x-csrf-token": csrf.token },
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR") };
  }

  const requestId = response.headers.get(REQUEST_ID_HEADER);
  const parsed = await readBoundedJson(response);
  if (!response.ok) {
    return {
      ok: false,
      error: normalizeHttpError({
        status: response.status,
        body: parsed.ok ? parsed.value : undefined,
        requestId,
      }),
    };
  }
  if (!parsed.ok || !isReferralLinkEnvelope(parsed.value)) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE", { status: response.status, requestId }) };
  }
  if (!isSafeExternalReferralUrl(parsed.value.referralUrl)) {
    // A structurally valid response carrying an unusable URL is a malformed
    // response, not a link. Nothing is opened.
    return { ok: false, error: makeError("MALFORMED_RESPONSE", { status: response.status, requestId }) };
  }
  return { ok: true, url: parsed.value.referralUrl, requestId };
}
