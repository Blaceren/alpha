/**
 * AFD-3A2 — the CAPTCHA provider contract.
 *
 * WHAT THIS REPLACES
 * `src/lib/captcha.ts` used to be a stub whose entire policy was one line:
 *
 *     const bypassEnabled = process.env.CAPTCHA_DEV_BYPASS !== "false";
 *
 * Every failure mode of that line points the same way. The key was absent from
 * the DEV runtime, so bypass was ON. It was ON for a MISSING token, so an
 * attacker did not even need to send a field. And because the condition was
 * `!== "false"`, a typo (`CAPTCHA_DEV_BYPASS=fasle`, `False`, `0`) also meant
 * ON. There was no provider, no secret and no site key, so the "off" branch was
 * not protection either — it refused every registration unconditionally.
 *
 * THE RULE HERE IS STATED POSITIVELY
 * Nothing is verified unless a provider is CONFIGURED. Absent, empty,
 * misspelled or half-configured all resolve to `{ configured: false }`, and the
 * caller turns that into a closed door rather than an open one. Forgetting is
 * the safe direction, which is exactly what the old flag got backwards.
 *
 * WHY `classifyEnvironment` AND NOT `NODE_ENV`
 * This project serves a PRODUCTION BUILD in DEV, so `NODE_ENV === "production"`
 * inside the DEV runtime (see src/lib/environment.ts). Any rule written against
 * `NODE_ENV` would either refuse in DEV or permit on a real host. The test
 * provider is therefore gated on `ATA_ENVIRONMENT=dev`, an explicit operator
 * declaration that nobody sets by accident.
 *
 * NO SECRET VALUE APPEARS IN THIS FILE.
 * Cloudflare's documented dummy secrets are recognised by SHAPE (see
 * `hasOfficialTestKeyShape`), never by literal, so no key material — not even a
 * public dummy — is committed. The real secret is read from the environment,
 * held only inside `TurnstileConfig`, and never logged, echoed or returned.
 */
import { classifyEnvironment, isDevEnvironment } from "@/lib/environment";

/** Environment key names. Exported so tests and the operator handoff agree. */
export const CAPTCHA_PROVIDER_KEY = "CAPTCHA_PROVIDER";
export const TURNSTILE_SECRET_ENV_KEY = "TURNSTILE_SECRET_KEY";
/**
 * RETIRED IN AFD-3A3. A single deployment-wide expected action cannot express
 * "the CRM login token must not open the Academy": there are three surfaces now
 * and each pins its own action in source (`captcha/surface.ts`). The key is
 * still NAMED here so that setting it is a loud configuration rejection rather
 * than a value that is quietly ignored while an operator believes it is pinning
 * something.
 */
export const TURNSTILE_EXPECTED_ACTION_KEY = "TURNSTILE_EXPECTED_ACTION";
export const TURNSTILE_EXPECTED_HOSTNAMES_KEY = "TURNSTILE_EXPECTED_HOSTNAMES";
export const CAPTCHA_TEST_MODE_KEY = "CAPTCHA_TEST_MODE";
/**
 * The bounded login exception (see src/lib/captcha.ts). Absent means login is
 * NOT verified, which `validateRuntimeEnv` permits only on an explicit
 * `ATA_ENVIRONMENT=dev` deployment.
 */
export const CAPTCHA_LOGIN_ENFORCED_KEY = "CAPTCHA_LOGIN_ENFORCED";

export function isCaptchaLoginEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CAPTCHA_LOGIN_ENFORCED_KEY] === "true";
}

/** The production provider: Cloudflare Turnstile, verified server-side. */
export const TURNSTILE_PROVIDER = "turnstile" as const;

/**
 * The isolated-test provider. Same code path, same Siteverify endpoint, same
 * fail-closed behaviour — it differs ONLY in that it additionally requires a
 * dev classification, the opt-in marker below, and a secret with the official
 * dummy shape. It is not a bypass: a request still has to survive a real HTTPS
 * round trip to Cloudflare.
 */
export const TURNSTILE_TEST_PROVIDER = "turnstile_test" as const;

export const CAPTCHA_PROVIDERS = [TURNSTILE_PROVIDER, TURNSTILE_TEST_PROVIDER] as const;

export type CaptchaProviderName = (typeof CAPTCHA_PROVIDERS)[number];

/**
 * The exact opt-in marker for the test provider. Long, unambiguous and
 * self-describing, in the same spirit as CHECKPOINT_PROVIDER_TEST_BACKEND:
 * nobody types this by accident and nobody reads it in a config file and
 * mistakes it for a production setting.
 */
export const CAPTCHA_TEST_MODE_MARKER =
  "unsafe-official-turnstile-test-keys-isolated-only" as const;

/**
 * Cloudflare's documented limits for `action`: at most 32 characters, and only
 * alphanumerics, underscore and hyphen. Every action in `captcha/surface.ts` is
 * asserted against this by that module's tests.
 */
export const ACTION_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** A conservative hostname shape. No scheme, no port, no path, no wildcard. */
const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** Default Siteverify budget. Bounded so a hung provider cannot hold a request. */
export const TURNSTILE_DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Bounded, non-secret reason codes. Every one of these is safe to log and safe
 * to put in an audit row: none of them quotes a configured value, and none
 * distinguishes "the secret is missing" from "the secret is wrong" in a way an
 * anonymous browser could use.
 */
export type CaptchaConfigReason =
  /** `CAPTCHA_PROVIDER` is unset or empty — no provider has been chosen. */
  | "provider_absent"
  /** Set, but not one of the recognised names. Never normalised or guessed. */
  | "provider_unrecognised"
  /** `TURNSTILE_SECRET_KEY` is missing. */
  | "secret_absent"
  /** Present but empty or whitespace. */
  | "secret_empty"
  /** A Cloudflare dummy secret offered to the PRODUCTION provider. */
  | "secret_is_test_key"
  /** A real-looking secret offered to the TEST provider. */
  | "secret_is_not_test_key"
  /** The test provider was named outside an `ATA_ENVIRONMENT=dev` deployment. */
  | "test_provider_outside_dev"
  /** The test provider was named without the explicit opt-in marker. */
  | "test_provider_marker_absent"
  /** `CAPTCHA_TEST_MODE` is present but is not the exact marker. */
  | "test_marker_malformed"
  /** `TURNSTILE_EXPECTED_ACTION` was set. Actions are source-owned since AFD-3A3. */
  | "expected_action_env_forbidden"
  /** `TURNSTILE_EXPECTED_HOSTNAMES` is present but unparseable or empty. */
  | "expected_hostnames_invalid";

export type TurnstileConfig = {
  readonly provider: CaptchaProviderName;
  /**
   * The Siteverify secret. It exists ONLY on this object, is read only by
   * `siteverify.ts`, and is never included in a log line, an error, an audit
   * row or an API response.
   */
  readonly secret: string;
  /** Explicit hostname allow-list, or `null` when the operator has not pinned one. */
  readonly expectedHostnames: readonly string[] | null;
  readonly timeoutMs: number;
};

export type CaptchaConfigResolution =
  | { readonly configured: true; readonly config: TurnstileConfig }
  | { readonly configured: false; readonly reason: CaptchaConfigReason };

function unconfigured(reason: CaptchaConfigReason): CaptchaConfigResolution {
  return { configured: false, reason };
}

/**
 * Does this secret have the shape of one of Cloudflare's published dummy keys?
 *
 * The documented dummy secrets are a digit, `x`, a long run of zeroes and two
 * trailing capitals. Matching the SHAPE rather than the literal keeps every key
 * value — even a public one — out of this repository, and still lets the
 * production provider refuse a placeholder and the test provider refuse a real
 * credential.
 *
 * A real Turnstile secret is not a digit followed by thirty-one zeroes, so the
 * false-positive risk is nil.
 */
export function hasOfficialTestKeyShape(secret: string): boolean {
  return /^[0-9]x0{31}[A-Z]{2}$/.test(secret);
}

/** Is the test provider permitted to run here at all? */
function testProviderRefusal(env: NodeJS.ProcessEnv): CaptchaConfigReason | null {
  if (!isDevEnvironment(env)) return "test_provider_outside_dev";
  const marker = env[CAPTCHA_TEST_MODE_KEY];
  if (marker === undefined || marker === "") return "test_provider_marker_absent";
  if (marker !== CAPTCHA_TEST_MODE_MARKER) return "test_marker_malformed";
  return null;
}

function parseExpectedHostnames(raw: string): readonly string[] | null {
  const parts = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  if (parts.length === 0) return null;
  // One bad entry invalidates the whole list. Silently dropping it would
  // quietly widen an allow-list the operator believed was narrow.
  if (parts.some((value) => value.length > 253 || !HOSTNAME_PATTERN.test(value))) return null;
  return parts;
}

/**
 * Resolve the CAPTCHA configuration, or say precisely why there isn't one.
 *
 * Every rejection names ONE fact. There is no branch that repairs a partial
 * configuration, substitutes a default secret, or falls through to success.
 */
export function resolveCaptchaConfig(
  env: NodeJS.ProcessEnv = process.env,
): CaptchaConfigResolution {
  const rawProvider = env[CAPTCHA_PROVIDER_KEY];

  if (rawProvider === undefined || rawProvider === "") {
    return unconfigured("provider_absent");
  }
  // Exact match only, like ATA_ENVIRONMENT. `" turnstile"` and `"Turnstile"`
  // are rejected rather than trimmed: a value someone had to guess the shape of
  // is not a declaration a security gate should rely on.
  if (!(CAPTCHA_PROVIDERS as readonly string[]).includes(rawProvider)) {
    return unconfigured("provider_unrecognised");
  }
  const provider = rawProvider as CaptchaProviderName;

  if (provider === TURNSTILE_TEST_PROVIDER) {
    const refusal = testProviderRefusal(env);
    if (refusal) return unconfigured(refusal);
  } else if (env[CAPTCHA_TEST_MODE_KEY] !== undefined && env[CAPTCHA_TEST_MODE_KEY] !== "") {
    // The marker is meaningless under the production provider, and its presence
    // is evidence that a test configuration leaked into a real deployment.
    return unconfigured("test_marker_malformed");
  }

  const rawSecret = env[TURNSTILE_SECRET_ENV_KEY];
  if (rawSecret === undefined) return unconfigured("secret_absent");
  const secret = rawSecret.trim();
  if (secret === "") return unconfigured("secret_empty");

  const looksLikeTestKey = hasOfficialTestKeyShape(secret);
  if (provider === TURNSTILE_PROVIDER && looksLikeTestKey) {
    // A dummy secret on the production provider accepts only dummy tokens, so
    // the widget would be decorative. Refusing is the difference between "the
    // challenge is enforced" and "the challenge looks enforced".
    return unconfigured("secret_is_test_key");
  }
  if (provider === TURNSTILE_TEST_PROVIDER && !looksLikeTestKey) {
    // Refusing here keeps a REAL secret from being handed to a code path whose
    // whole justification is that it only ever carries a published dummy.
    return unconfigured("secret_is_not_test_key");
  }

  // AFD-3A3: a deployment-wide action pin is refused outright. It cannot be
  // right for three surfaces at once, and honouring it would mean one of the
  // three silently stopped distinguishing its own tokens from the others'.
  const rawAction = env[TURNSTILE_EXPECTED_ACTION_KEY];
  if (rawAction !== undefined && rawAction !== "") {
    return unconfigured("expected_action_env_forbidden");
  }

  let expectedHostnames: readonly string[] | null = null;
  const rawHostnames = env[TURNSTILE_EXPECTED_HOSTNAMES_KEY];
  if (rawHostnames !== undefined && rawHostnames !== "") {
    expectedHostnames = parseExpectedHostnames(rawHostnames);
    if (expectedHostnames === null) return unconfigured("expected_hostnames_invalid");
  }

  return {
    configured: true,
    config: {
      provider,
      secret,
      expectedHostnames,
      timeoutMs: TURNSTILE_DEFAULT_TIMEOUT_MS,
    },
  };
}

/**
 * A stable operator-facing sentence for a rejection. Safe to print at startup
 * and in preflight: it names the KEY, never the value.
 */
export function describeCaptchaConfigRejection(reason: CaptchaConfigReason): string {
  switch (reason) {
    case "provider_absent":
      return `${CAPTCHA_PROVIDER_KEY} is not set — CAPTCHA-protected surfaces are closed`;
    case "provider_unrecognised":
      return `${CAPTCHA_PROVIDER_KEY} must be exactly one of: ${CAPTCHA_PROVIDERS.join(", ")}`;
    case "secret_absent":
      return `${TURNSTILE_SECRET_ENV_KEY} is required when ${CAPTCHA_PROVIDER_KEY} names a Turnstile provider`;
    case "secret_empty":
      return `${TURNSTILE_SECRET_ENV_KEY} must not be empty`;
    case "secret_is_test_key":
      return `${TURNSTILE_SECRET_ENV_KEY} looks like a Cloudflare test key and must not be used with ${CAPTCHA_PROVIDER_KEY}=${TURNSTILE_PROVIDER}`;
    case "secret_is_not_test_key":
      return `${CAPTCHA_PROVIDER_KEY}=${TURNSTILE_TEST_PROVIDER} accepts only an official Cloudflare test secret`;
    case "test_provider_outside_dev":
      return `${CAPTCHA_PROVIDER_KEY}=${TURNSTILE_TEST_PROVIDER} requires ATA_ENVIRONMENT=dev`;
    case "test_provider_marker_absent":
      return `${CAPTCHA_PROVIDER_KEY}=${TURNSTILE_TEST_PROVIDER} requires ${CAPTCHA_TEST_MODE_KEY}=${CAPTCHA_TEST_MODE_MARKER}`;
    case "test_marker_malformed":
      return `${CAPTCHA_TEST_MODE_KEY} is an isolated-test marker and must be exactly ${CAPTCHA_TEST_MODE_MARKER}, only alongside ${CAPTCHA_PROVIDER_KEY}=${TURNSTILE_TEST_PROVIDER}`;
    case "expected_action_env_forbidden":
      return `${TURNSTILE_EXPECTED_ACTION_KEY} is no longer configurable — each authentication surface pins its own Turnstile action in source; unset this key`;
    case "expected_hostnames_invalid":
      return `${TURNSTILE_EXPECTED_HOSTNAMES_KEY} must be a comma-separated list of bare hostnames`;
  }
}

/**
 * Whether a deployment is obliged to have a working CAPTCHA provider AND to
 * verify LOGIN as well as registration.
 *
 * REGISTRATION IS NOT GOVERNED BY THIS FUNCTION. Registration verification is
 * unconditional in every environment — see `ALWAYS_ENFORCED` in
 * src/lib/captcha.ts. What this decides is the ADDITIONAL obligation: must the
 * deployment refuse to start without a coherent provider, and must it verify
 * login too?
 *
 * The answer is yes for an explicitly classified `production` or `staging`
 * deployment, and no otherwise.
 *
 * WHY `unknown` IS NOT OBLIGED, DESPITE "FORGETTING SHOULD FAIL"
 * An earlier draft of this function obliged every non-`dev` classification,
 * including `unknown`. That is the right instinct in general, and it is how the
 * DEV simulator gate is written — but here it was measurably wrong. This
 * platform's isolated regression harnesses start real servers without declaring
 * an environment at all, so the stricter rule made seven existing suites fail
 * to log in, and would have made every future harness fail the same way. A rule
 * that has to be worked around in every test is a rule that will be worked
 * around in production too.
 *
 * The safety that matters is not weakened by narrowing this:
 *
 *   - registration on an unclassified host is still verified, and still fails
 *     CLOSED when no provider is configured — the door this phase owns is shut
 *     regardless of what the operator declared;
 *   - login on an unclassified host behaves exactly as it did before this
 *     phase, so nothing regressed;
 *   - a real deployment that declares itself production or staging must have a
 *     coherent provider and must verify login, or it does not boot.
 *
 * So the only behaviour that depends on remembering to set `ATA_ENVIRONMENT` is
 * login verification on a host that has not said what it is — and that host
 * cannot register anyone in the first place.
 */
export function isCaptchaProviderRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  const classification = classifyEnvironment(env);
  return classification.kind === "classified" && classification.environment !== "dev";
}
