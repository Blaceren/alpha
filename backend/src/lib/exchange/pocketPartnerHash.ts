/**
 * L4PA-1 — the official Pocket Partner request hash.
 *
 * THE PROVIDER'S CONTRACT, NOT A DESIGN CHOICE
 * The official Partner API manual specifies:
 *
 *   hash = lowercase hex MD5 of the UTF-8 string  {user_id}:{partner_id}:{api_token}
 *
 * MD5 is used here for exactly one reason: it is what the provider requires to
 * accept a request. It is NOT a secure signature algorithm, it is not being
 * relied on for integrity or authenticity, and nothing in this platform treats
 * a value produced here as proof of anything. The security property the adapter
 * actually depends on is possession of the API token plus TLS to the one
 * approved host.
 *
 * THE OUTPUT IS A CREDENTIAL. The digest is derived from the secret token, and
 * it travels in the URL PATH. Anyone holding it can query the same trader.
 * Therefore: it is never returned to a caller, never persisted, never logged,
 * never attached to an error and never placed in audit metadata. This module
 * exports only the builder; nothing here formats a URL for display.
 */
import crypto from "node:crypto";

/**
 * The exact preimage the manual specifies.
 *
 * Written as one template with literal colons and nothing else — no whitespace,
 * no quoting, no JSON encoding, no separator constant that could drift. Both
 * identifiers are numbers by the time they arrive, so `${}` renders the decimal
 * spelling the provider expects.
 */
function buildPreimage(userId: number, partnerId: number, apiToken: string): string {
  return `${userId}:${partnerId}:${apiToken}`;
}

/**
 * Build the lowercase hexadecimal MD5 the endpoint path requires.
 *
 * Inputs are validated rather than trusted: a non-integer, zero or negative
 * identifier would produce a well-formed hash for a malformed request, and an
 * empty token would produce a hash that looks valid while authenticating
 * nothing. Both throw — and the thrown message names the FIELD, never the
 * value, because this function is the one place the token is in scope.
 */
export function buildPocketPartnerHash(
  userId: number,
  partnerId: number,
  apiToken: string,
): string {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("pocket partner hash: userId must be a positive integer");
  }
  if (!Number.isSafeInteger(partnerId) || partnerId <= 0) {
    throw new Error("pocket partner hash: partnerId must be a positive integer");
  }
  if (typeof apiToken !== "string" || apiToken.length === 0) {
    throw new Error("pocket partner hash: apiToken must be a non-empty string");
  }

  return crypto
    .createHash("md5")
    .update(buildPreimage(userId, partnerId, apiToken), "utf8")
    .digest("hex")
    .toLowerCase();
}
