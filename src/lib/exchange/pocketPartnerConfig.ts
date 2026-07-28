/**
 * L4PA-1 — configuration for the official Pocket Partner user-info API.
 *
 * THE SHAPE OF THE OFFICIAL CONTRACT
 *   GET {base}/api/user-info/{user_id}/{partner_id}/{hash}
 * where `hash` is an MD5 over a preimage containing the secret API token. That
 * makes the URL PATH itself credential-bearing, which is why this file is
 * strict about what a base URL may be: a base that could be redirected,
 * downgraded to HTTP, or pointed at an attacker's host would hand over a
 * derived credential on every verification.
 *
 * FAIL CLOSED BY DEFAULT. Absent configuration is not an error and not a
 * fallback — it resolves to `configured: false`, which the provider renders as
 * `provider_unconfigured`. There is no default base URL, no default Partner ID,
 * no development token and no code path that returns a partial configuration.
 *
 * NO VALUE IS EVER ECHOED. Nothing here throws with a value in the message and
 * nothing returns the token in a diagnostic: an invalid configuration produces a
 * bounded reason code, never the offending string.
 */

/** The one production host the adapter may contact. */
export const POCKET_PARTNER_PRODUCTION_HOST = "pocketpartners.com";

/** Path prefix of the official endpoint, appended to the configured base. */
export const POCKET_PARTNER_USER_INFO_PATH = "/api/user-info";

/** Default bounded deadline. The engine independently enforces its own 5s cap. */
export const POCKET_PARTNER_DEFAULT_TIMEOUT_MS = 5_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 15_000;

/**
 * The opt-in that allows a loopback HTTP base URL. Deliberately awkward, and
 * shaped like the existing `CHECKPOINT_PROVIDER_TEST_BACKEND` marker so the
 * repository has one recognisable idiom for "this is test-only". Production env
 * validation rejects it outright (see env.ts), and it is additionally refused
 * whenever NODE_ENV is not exactly `test`.
 */
export const POCKET_PARTNER_TEST_MARKER = "unsafe-loopback-mock-regression-only";

/** A token that is obviously not a real secret must never reach a real host. */
const TEST_TOKEN_MARKERS = ["test-token-not-a-real-pocket-secret", "unsafe-", "dummy", "example"];

const MAX_TOKEN_LENGTH = 512;
const MIN_TOKEN_LENGTH = 8;

/** Bounded, non-secret reason codes. Safe to log; none quotes a value. */
export type PocketPartnerConfigReason =
  | "disabled"
  | "missing_base_url"
  | "missing_partner_id"
  | "missing_api_token"
  | "invalid_base_url"
  | "insecure_scheme"
  | "unexpected_host"
  | "url_credentials_present"
  | "url_query_present"
  | "url_fragment_present"
  | "unexpected_base_path"
  | "invalid_partner_id"
  | "invalid_api_token"
  | "test_token_rejected"
  | "loopback_not_allowed"
  | "test_marker_not_allowed";

export type PocketPartnerConfig = {
  readonly configured: true;
  /** Origin only, no trailing slash. The path is built, never configured. */
  readonly baseUrl: string;
  readonly partnerId: number;
  readonly apiToken: string;
  readonly timeoutMs: number;
  /** True only in the loopback test mode. Never true against production. */
  readonly testMode: boolean;
};

export type PocketPartnerConfigResolution =
  | PocketPartnerConfig
  | { readonly configured: false; readonly reason: PocketPartnerConfigReason };

function unconfigured(reason: PocketPartnerConfigReason) {
  return { configured: false as const, reason };
}

/**
 * True when the process is permitted to accept a loopback HTTP base URL.
 *
 * BOTH conditions are required, and neither implies the other: `NODE_ENV=test`
 * without the marker is an ordinary test run that must still refuse an insecure
 * base, and the marker outside `NODE_ENV=test` is a misconfiguration that must
 * not silently weaken transport security.
 */
function testModeAllowed(env: NodeJS.ProcessEnv): boolean {
  return (
    env.NODE_ENV === "test" &&
    env.POCKET_PARTNER_API_TEST_MODE === POCKET_PARTNER_TEST_MARKER
  );
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/**
 * Resolve and fully validate the provider configuration.
 *
 * Validation order is deliberate: presence, then URL structure, then transport,
 * then host, then credential shape. Each check answers one question, so a
 * rejection reason names one fact and a misconfiguration cannot pass by
 * satisfying a later, laxer rule.
 */
export function resolvePocketPartnerConfig(
  env: NodeJS.ProcessEnv = process.env,
): PocketPartnerConfigResolution {
  const rawBase = env.POCKET_PARTNER_API_BASE_URL?.trim();
  const rawPartnerId = env.POCKET_PARTNER_ID?.trim();
  const rawToken = env.POCKET_PARTNER_API_TOKEN;

  if (!rawBase) return unconfigured("missing_base_url");
  if (!rawPartnerId) return unconfigured("missing_partner_id");
  if (typeof rawToken !== "string" || rawToken.trim().length === 0) {
    return unconfigured("missing_api_token");
  }

  let url: URL;
  try {
    url = new URL(rawBase);
  } catch {
    return unconfigured("invalid_base_url");
  }

  // Credentials in the URL would be sent on every request and would land in any
  // error object that quotes the URL. Refused before anything else about the
  // host is considered.
  if (url.username.length > 0 || url.password.length > 0) {
    return unconfigured("url_credentials_present");
  }
  if (url.search.length > 0) return unconfigured("url_query_present");
  if (url.hash.length > 0) return unconfigured("url_fragment_present");

  // The endpoint path is constructed by this platform. A base that already
  // carries a path could silently redirect the request somewhere else.
  if (url.pathname !== "/" && url.pathname !== "") {
    return unconfigured("unexpected_base_path");
  }

  const allowTestMode = testModeAllowed(env);
  const loopback = isLoopbackHost(url.hostname);

  if (url.protocol === "http:") {
    // A derived credential travels in the path; plaintext is never acceptable
    // to a real host, and acceptable to loopback only under the explicit marker.
    if (!loopback) return unconfigured("insecure_scheme");
    if (!allowTestMode) {
      return env.POCKET_PARTNER_API_TEST_MODE
        ? unconfigured("test_marker_not_allowed")
        : unconfigured("insecure_scheme");
    }
  } else if (url.protocol !== "https:") {
    return unconfigured("insecure_scheme");
  }

  if (loopback) {
    if (!allowTestMode) return unconfigured("loopback_not_allowed");
  } else if (url.hostname !== POCKET_PARTNER_PRODUCTION_HOST) {
    // Exact host match. A subdomain is not the approved host, and neither is a
    // lookalike: this is the only place the adapter is allowed to point.
    return unconfigured("unexpected_host");
  }

  const partnerId = Number(rawPartnerId);
  if (
    !/^[1-9][0-9]*$/.test(rawPartnerId) ||
    !Number.isSafeInteger(partnerId) ||
    partnerId <= 0
  ) {
    return unconfigured("invalid_partner_id");
  }

  const apiToken = rawToken;
  if (
    apiToken.trim() !== apiToken ||
    apiToken.length < MIN_TOKEN_LENGTH ||
    apiToken.length > MAX_TOKEN_LENGTH
  ) {
    return unconfigured("invalid_api_token");
  }

  // An obviously synthetic token is a configuration mistake anywhere it is not
  // paired with the loopback test mode. Refusing it here means a copied example
  // credential can never be sent to the real provider.
  const looksSynthetic = TEST_TOKEN_MARKERS.some((marker) =>
    apiToken.toLowerCase().includes(marker),
  );
  if (looksSynthetic && !(allowTestMode && loopback)) {
    return unconfigured("test_token_rejected");
  }

  return {
    configured: true,
    baseUrl: url.origin,
    partnerId,
    apiToken,
    timeoutMs: resolveTimeoutMs(env),
    testMode: allowTestMode && loopback,
  };
}

/** Bounded timeout. An unparseable or out-of-range value falls back, never throws. */
function resolveTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env.POCKET_PARTNER_API_TIMEOUT_MS?.trim();
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return POCKET_PARTNER_DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    return POCKET_PARTNER_DEFAULT_TIMEOUT_MS;
  }
  return value;
}
