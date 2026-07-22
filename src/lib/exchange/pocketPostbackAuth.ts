import crypto from "node:crypto";

// Fail-closed authentication contract for the Pocket postback intake.
//
// The previous contract read POCKET_POSTBACK_REQUIRE_SECRET and skipped the
// secret check entirely whenever that variable was absent or not "true", so a
// missing environment variable disabled authentication on a route that mutates
// ExchangeAccount money state and money-linked progression. That interpretation
// is removed: the integration is disabled unless POCKET_POSTBACK_ENABLED is
// exactly "true", and when it is enabled a valid header secret is mandatory.

/** The single documented authentication header for Pocket postbacks. */
export const POCKET_POSTBACK_SECRET_HEADER = "x-postback-secret";

/** Bounded secret strength. Documented in docs/env.md. */
export const POCKET_SECRET_MIN_LENGTH = 16;
export const POCKET_SECRET_MAX_LENGTH = 200;

/** Printable ASCII, no whitespace, no comma (comma would make a duplicated header ambiguous). */
const SECRET_CHARSET = /^[\x21-\x2b\x2d-\x7e]+$/;

/**
 * Bounded rejection reason enum. Every security event records one of these and
 * nothing else — no secret, no payload, no header value.
 */
export const PocketRejectionReason = {
  Disabled: "integration_disabled",
  QueryAuthMaterial: "query_auth_material",
  MissingHeader: "missing_auth_header",
  MalformedHeader: "malformed_auth_header",
  AmbiguousHeader: "ambiguous_auth_header",
  SecretMismatch: "secret_mismatch",
  RateLimited: "rate_limited",
  QueryShape: "query_shape",
  UnknownGoal: "unknown_goal",
  InvalidAmount: "invalid_amount",
  MissingClickId: "missing_click_id",
  UnknownClickId: "unknown_click_id",
  ValidationError: "validation_error",
} as const;

export type PocketRejectionReason =
  (typeof PocketRejectionReason)[keyof typeof PocketRejectionReason];

export type PocketPostbackConfig =
  | { enabled: true; secret: string }
  | { enabled: false };

/**
 * The one authoritative Pocket secret resolver. There is no default secret, no
 * development fallback and no code path that returns a secret while reporting
 * the integration as disabled. A weak or malformed secret is treated exactly
 * like an absent one, so a misconfiguration can never widen the auth surface.
 *
 * Errors are never thrown from here and no value is ever echoed, so the secret
 * cannot escape through a stack trace or a log line.
 */
export function resolvePocketPostbackConfig(
  env: Record<string, string | undefined> = process.env,
): PocketPostbackConfig {
  if (env.POCKET_POSTBACK_ENABLED !== "true") {
    return { enabled: false };
  }

  const secret = env.POSTBACK_SECRET;

  if (typeof secret !== "string" || !isAcceptableSecret(secret)) {
    return { enabled: false };
  }

  return { enabled: true, secret };
}

/** Whitespace-only, too short, too long and non-printable secrets are all invalid. */
export function isAcceptableSecret(secret: string): boolean {
  return (
    secret.trim() === secret &&
    secret.length >= POCKET_SECRET_MIN_LENGTH &&
    secret.length <= POCKET_SECRET_MAX_LENGTH &&
    SECRET_CHARSET.test(secret)
  );
}

/**
 * Length-independent constant-time comparison.
 *
 * crypto.timingSafeEqual throws on unequal lengths, which would itself leak the
 * expected length. HMAC-ing both sides under a per-process random key produces
 * two fixed-width digests that can always be compared in constant time, and the
 * key is never persisted or exposed.
 */
const COMPARISON_KEY = crypto.randomBytes(32);

export function timingSafeSecretEqual(provided: string, expected: string): boolean {
  const a = crypto.createHmac("sha256", COMPARISON_KEY).update(provided, "utf8").digest();
  const b = crypto.createHmac("sha256", COMPARISON_KEY).update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

export type PocketAuthOutcome =
  | { ok: true }
  | { ok: false; reason: PocketRejectionReason };

/**
 * Structural validation of the authentication header followed by a timing-safe
 * comparison. Missing, empty, malformed and wrong secrets all resolve to a
 * rejection the caller renders identically, so the response is not an oracle.
 *
 * Node joins duplicate header values with ", "; because an acceptable secret
 * can never contain a comma, a comma in the received value means the caller
 * sent the header more than once and the request is ambiguous.
 */
export function authenticatePocketRequest(
  headers: Headers,
  expectedSecret: string,
): PocketAuthOutcome {
  const raw = headers.get(POCKET_POSTBACK_SECRET_HEADER);

  if (raw === null || raw.length === 0) {
    return { ok: false, reason: PocketRejectionReason.MissingHeader };
  }

  if (raw.includes(",")) {
    return { ok: false, reason: PocketRejectionReason.AmbiguousHeader };
  }

  if (!isAcceptableSecret(raw)) {
    return { ok: false, reason: PocketRejectionReason.MalformedHeader };
  }

  if (!timingSafeSecretEqual(raw, expectedSecret)) {
    return { ok: false, reason: PocketRejectionReason.SecretMismatch };
  }

  return { ok: true };
}

/**
 * True when the caller tried to authenticate through the URL. Checked before
 * the header so a legacy `?ow=<secret>` integration fails loudly instead of
 * silently continuing to transmit a secret in a URL.
 */
export function hasQueryAuthMaterial(
  params: URLSearchParams,
  secretQueryKeys: readonly string[],
): boolean {
  for (const key of params.keys()) {
    if (secretQueryKeys.includes(key.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Non-reversible fingerprint of an event identifier, safe for AuditLog metadata.
 * The raw identifier is never audited on a security-rejection path.
 */
export function fingerprintEventId(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}
