/**
 * AFD-3B2 — the one place that decides whether acquisition attribution is on,
 * and the one place that judges its signing secret.
 *
 * TWO SEPARATE FACTS, DELIBERATELY. "The operator asked for attribution" and
 * "the deployment can safely sign a token" are different questions, and
 * collapsing them is how a feature ends up half-enabled: a route that answers,
 * a cookie that is issued, and a signature that anyone can forge. Here, asking
 * for attribution without a usable secret is a refusal — at startup, loudly —
 * and never a degraded mode.
 *
 * WHY THERE IS NO UNSIGNED FALLBACK. The attribution token is the only thing
 * standing between "this visitor came from affiliate X" and "this visitor says
 * they came from affiliate X". A fallback that signed with a default key would
 * let anyone mint a journey and, at the next registration, spend it. So there
 * is no default key, no dev key and no "unsigned in development" branch.
 */
import crypto from "node:crypto";
import { TURNSTILE_SECRET_ENV_KEY } from "@/lib/captcha/provider";

export const AFFILIATE_ATTRIBUTION_ENABLED_KEY = "AFFILIATE_ATTRIBUTION_ENABLED";
export const ATTRIBUTION_TOKEN_SECRET_KEY = "ATTRIBUTION_TOKEN_SECRET";

/**
 * The floor a secret must clear.
 *
 * 43 characters is the unpadded base64url length of 32 random bytes, so the
 * documented way to produce one — `openssl rand -base64 32` — passes and a
 * hand-typed passphrase does not. This is a floor on LENGTH AND VARIETY, not a
 * proof of entropy: no runtime check can tell 256 random bits from 256 bits an
 * operator chose badly. It exists to reject the mistakes that actually happen —
 * a short string, a repeated character, a copied placeholder — not to certify
 * the good case.
 */
export const ATTRIBUTION_SECRET_MIN_LENGTH = 43;
const ATTRIBUTION_SECRET_MIN_DISTINCT_CHARS = 12;

/** Values that look like a secret and are not one. */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /^change[-_ ]?me/i,
  /^placeholder/i,
  /^replace[-_ ]?me/i,
  /^your[-_ ]?secret/i,
  /^todo/i,
  /^example/i,
  /^sample/i,
  /^dummy/i,
  /^insert[-_ ]?/i,
  /^dev[-_ ]?secret/i,
  /^local[-_ ]?secret/i,
  /^test[-_ ]?secret/i,
  /^attribution[-_ ]?secret/i,
  /x{8,}/i,
  /^(.)\1+$/,
];

export type AttributionSecretRejection =
  | "missing"
  | "too_short"
  | "low_variety"
  | "placeholder"
  | "reused_session_secret"
  | "reused_postback_secret"
  | "reused_captcha_secret";

export type AttributionConfig =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly secret: string };

export type AttributionConfigResolution =
  | { readonly kind: "resolved"; readonly config: AttributionConfig }
  | { readonly kind: "invalid"; readonly reason: AttributionSecretRejection };

/** Whether the operator asked for attribution. Absent means no. */
export function isAffiliateAttributionRequested(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[AFFILIATE_ATTRIBUTION_ENABLED_KEY] === "true";
}

/**
 * Judge a candidate secret. The value is NEVER quoted in the result: every
 * rejection is a bounded code, so no caller can leak the secret into a log, an
 * audit row, a startup message or an HTTP response by reporting why it failed.
 */
export function describeSecretRejection(
  raw: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): AttributionSecretRejection | null {
  if (raw === undefined || raw.trim() === "") return "missing";
  const value = raw.trim();

  if (value.length < ATTRIBUTION_SECRET_MIN_LENGTH) return "too_short";
  // Placeholder BEFORE variety. A padded-out "change-me-change-me-…" fails both
  // tests, and "you never replaced the placeholder" is the fact an operator can
  // act on — "too few distinct characters" would send them off inventing a more
  // varied placeholder.
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value))) return "placeholder";
  if (new Set(value).size < ATTRIBUTION_SECRET_MIN_DISTINCT_CHARS) return "low_variety";

  // SEPARATION IS NOT COSMETIC. A secret shared with the session signer means a
  // forged attribution token and a forged session are the same forgery, and one
  // rotation reason becomes every rotation reason. Compared by value because
  // that is the only way an accidental copy-paste is visible.
  if (env.SESSION_SECRET && value === env.SESSION_SECRET.trim()) return "reused_session_secret";
  if (env.POSTBACK_SECRET && value === env.POSTBACK_SECRET.trim()) return "reused_postback_secret";
  const captchaSecret = env[TURNSTILE_SECRET_ENV_KEY];
  if (captchaSecret && value === captchaSecret.trim()) return "reused_captcha_secret";

  return null;
}

export function describeAttributionConfigRejection(reason: AttributionSecretRejection): string {
  const prefix = `${AFFILIATE_ATTRIBUTION_ENABLED_KEY}=true requires ${ATTRIBUTION_TOKEN_SECRET_KEY}`;
  switch (reason) {
    case "missing":
      return `${prefix} — it is absent or empty`;
    case "too_short":
      return `${prefix} — it is shorter than ${ATTRIBUTION_SECRET_MIN_LENGTH} characters (generate one with: openssl rand -base64 32)`;
    case "low_variety":
      return `${prefix} — it repeats too few distinct characters to be a random value`;
    case "placeholder":
      return `${prefix} — it matches a placeholder pattern and was never replaced`;
    case "reused_session_secret":
      return `${prefix} — it must not be the same value as SESSION_SECRET`;
    case "reused_postback_secret":
      return `${prefix} — it must not be the same value as POSTBACK_SECRET`;
    case "reused_captcha_secret":
      return `${prefix} — it must not be the same value as ${TURNSTILE_SECRET_ENV_KEY}`;
  }
}

/**
 * The authoritative resolution. Disabled resolves cleanly whatever the secret
 * looks like — a deployment that is not using attribution is not obliged to
 * hold a key for it.
 */
export function resolveAttributionConfig(
  env: NodeJS.ProcessEnv = process.env,
): AttributionConfigResolution {
  if (!isAffiliateAttributionRequested(env)) {
    return { kind: "resolved", config: { enabled: false } };
  }

  const reason = describeSecretRejection(env[ATTRIBUTION_TOKEN_SECRET_KEY], env);
  if (reason !== null) return { kind: "invalid", reason };

  return {
    kind: "resolved",
    config: { enabled: true, secret: (env[ATTRIBUTION_TOKEN_SECRET_KEY] as string).trim() },
  };
}

/**
 * Read at call time, never captured at module load: a long-lived server and a
 * regression suite that flips the flag between cases must both see the truth.
 */
export function isAffiliateAttributionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const resolution = resolveAttributionConfig(env);
  return resolution.kind === "resolved" && resolution.config.enabled;
}

export class AttributionSecretUnavailableError extends Error {
  constructor(readonly reason: AttributionSecretRejection | "disabled") {
    // The reason is a bounded code and the secret is not in the message.
    super(`attribution secret unavailable: ${reason}`);
    this.name = "AttributionSecretUnavailableError";
  }
}

/**
 * The only way to obtain the signing key. Throws rather than returning a
 * fallback, so a caller that forgets to check the flag fails closed instead of
 * signing with something predictable.
 */
export function requireAttributionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const resolution = resolveAttributionConfig(env);
  if (resolution.kind === "invalid") throw new AttributionSecretUnavailableError(resolution.reason);
  if (!resolution.config.enabled) throw new AttributionSecretUnavailableError("disabled");
  return resolution.config.secret;
}

/**
 * A stable, non-reversible fingerprint of the configured secret, for operational
 * checks that need to answer "is this the same key as before" without ever
 * reading the key. Truncated to 12 hex characters: enough to notice a rotation,
 * far too little to attack the preimage.
 */
export function attributionSecretFingerprint(env: NodeJS.ProcessEnv = process.env): string | null {
  const resolution = resolveAttributionConfig(env);
  if (resolution.kind === "invalid" || !resolution.config.enabled) return null;
  return crypto
    .createHash("sha256")
    .update(`ata.attribution.fingerprint.v1:${resolution.config.secret}`)
    .digest("hex")
    .slice(0, 12);
}
