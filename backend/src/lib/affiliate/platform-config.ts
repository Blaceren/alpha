/**
 * AFFILIATE-PLATFORM-V1 §36 — the one place that decides which parts of the
 * partner platform are live, and the one place that judges the partner session
 * secret.
 *
 * THREE SWITCHES, NOT ONE, AND THE ORDER MATTERS.
 *
 *   AFFILIATE_PLATFORM_ENABLED           may a partner sign in and read
 *   AFFILIATE_CPA_QUALIFICATION_ENABLED  may a deposit MINT MONEY
 *   AFFILIATE_POSTBACK_DELIVERY_ENABLED  may the server make an outbound request
 *
 * They are separate because they carry completely different risk. The first
 * exposes an authenticated read surface. The second creates a liability ATA
 * owes a counterparty. The third makes this server issue HTTP requests to
 * addresses a partner chose. Collapsing them into one flag would mean the only
 * way to let a partner look at their statistics is to simultaneously arm both
 * of the other two — which is exactly the accident §36 exists to prevent.
 *
 * THE ROLLOUT THE SEPARATION BUYS. Schema and runtime deploy with money OFF and
 * outbound OFF; the portal, its tenant isolation and its reporting are accepted
 * against data that already exists; the commercial fixture is configured and
 * reviewed; only then is qualification armed, and only then does a fresh
 * attributed deposit produce the first commission. No historical traffic can
 * mint a liability during a deploy, because nothing is armed during a deploy.
 *
 * WHY QUALIFICATION IS NOT MERELY "THE PORTAL PLUS MONEY". A CPA qualification
 * is written inside the deposit path, which runs whether or not any partner has
 * ever signed in. So its switch is read there, independently, and does not
 * consult the portal switch at all: an operator who turned the portal off to
 * investigate something must not thereby stop recording money that has been
 * legitimately earned.
 */
import crypto from "node:crypto";
import { ATTRIBUTION_TOKEN_SECRET_KEY } from "@/lib/affiliate/attribution-config";
import { TURNSTILE_SECRET_ENV_KEY } from "@/lib/captcha/provider";

export const AFFILIATE_PLATFORM_ENABLED_KEY = "AFFILIATE_PLATFORM_ENABLED";
export const AFFILIATE_CPA_QUALIFICATION_ENABLED_KEY = "AFFILIATE_CPA_QUALIFICATION_ENABLED";
export const AFFILIATE_POSTBACK_DELIVERY_ENABLED_KEY = "AFFILIATE_POSTBACK_DELIVERY_ENABLED";
export const PARTNER_SESSION_SECRET_KEY = "PARTNER_SESSION_SECRET";

/**
 * The floor a partner session secret must clear, and the reasons a candidate is
 * refused.
 *
 * IDENTICAL RULES TO THE ATTRIBUTION SECRET, INTENTIONALLY, and one extra: this
 * secret must not BE any of the four secrets this deployment already holds.
 * §30 forbids reusing POSTBACK_SECRET, SESSION_SECRET or
 * ATTRIBUTION_TOKEN_SECRET for partner signing, and the same argument applies
 * to the token that authenticates a partner human: a secret shared between two
 * trust domains means compromising either one compromises both, and rotating
 * either one silently invalidates the other.
 *
 * THE VALUE IS NEVER QUOTED IN A RESULT. Every rejection is a bounded code, so
 * no caller can leak the secret into a log, an audit row, a startup message or
 * an HTTP response by reporting why it failed.
 */
export const PARTNER_SESSION_SECRET_MIN_LENGTH = 43;
const PARTNER_SESSION_SECRET_MIN_DISTINCT_CHARS = 12;

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
  /^partner[-_ ]?secret/i,
  /x{8,}/i,
  /^(.)\1+$/,
];

export type PartnerSessionSecretRejection =
  | "missing"
  | "too_short"
  | "low_variety"
  | "placeholder"
  | "reused_session_secret"
  | "reused_postback_secret"
  | "reused_attribution_secret"
  | "reused_captcha_secret";

const REJECTION_DETAIL: Record<PartnerSessionSecretRejection, string> = {
  missing: "must be set when the affiliate platform is enabled",
  too_short: `must be at least ${PARTNER_SESSION_SECRET_MIN_LENGTH} characters`,
  low_variety: `must contain at least ${PARTNER_SESSION_SECRET_MIN_DISTINCT_CHARS} distinct characters`,
  placeholder: "must not be a placeholder value",
  reused_session_secret: "must not reuse SESSION_SECRET",
  reused_postback_secret: "must not reuse POSTBACK_SECRET",
  reused_attribution_secret: `must not reuse ${ATTRIBUTION_TOKEN_SECRET_KEY}`,
  reused_captcha_secret: `must not reuse ${TURNSTILE_SECRET_ENV_KEY}`,
};

export function describePartnerSessionSecretRejection(
  reason: PartnerSessionSecretRejection,
): string {
  return `${PARTNER_SESSION_SECRET_KEY} ${REJECTION_DETAIL[reason]}`;
}

/** Whether the operator asked for the partner platform. Absent means no. */
export function isAffiliatePlatformRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[AFFILIATE_PLATFORM_ENABLED_KEY] === "true";
}

/**
 * Whether a qualifying deposit may create a CPA qualification and a commission.
 *
 * READ AT THE MOMENT OF THE DEPOSIT, not cached, and deliberately independent
 * of the portal switch — see the module header.
 */
export function isCpaQualificationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[AFFILIATE_CPA_QUALIFICATION_ENABLED_KEY] === "true";
}

/**
 * Whether the delivery worker may make an outbound HTTP request.
 *
 * WHEN THIS IS OFF, DELIVERIES ARE STILL ENQUEUED. That is the point of an
 * outbox: the record that a partner is owed a notification is a fact about the
 * conversion, and it survives the transport being disabled. Turning the switch
 * on later drains the queue rather than losing it.
 */
export function isPostbackDeliveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[AFFILIATE_POSTBACK_DELIVERY_ENABLED_KEY] === "true";
}

/** Constant-time equality that never short-circuits on length. */
function equalsSecret(candidate: string, other: string | undefined): boolean {
  if (typeof other !== "string" || other === "") return false;
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(other, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Judge a candidate partner session secret. Returns a bounded reason or null.
 */
export function describeSecretRejection(
  raw: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): PartnerSessionSecretRejection | null {
  if (raw === undefined || raw.trim() === "") return "missing";
  const value = raw.trim();
  if (value.length < PARTNER_SESSION_SECRET_MIN_LENGTH) return "too_short";
  if (new Set(value).size < PARTNER_SESSION_SECRET_MIN_DISTINCT_CHARS) return "low_variety";
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value))) return "placeholder";
  if (equalsSecret(value, env.SESSION_SECRET)) return "reused_session_secret";
  if (equalsSecret(value, env.POSTBACK_SECRET)) return "reused_postback_secret";
  if (equalsSecret(value, env[ATTRIBUTION_TOKEN_SECRET_KEY])) return "reused_attribution_secret";
  if (equalsSecret(value, env[TURNSTILE_SECRET_ENV_KEY])) return "reused_captcha_secret";
  return null;
}

export type PartnerPlatformConfig =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly sessionSecret: string };

export type PartnerPlatformConfigResolution =
  | { readonly kind: "resolved"; readonly config: PartnerPlatformConfig }
  | { readonly kind: "invalid"; readonly reason: PartnerSessionSecretRejection };

/**
 * Resolve the platform configuration.
 *
 * ASKING FOR THE PLATFORM WITHOUT A USABLE SECRET IS A REFUSAL, at startup,
 * loudly — never a degraded mode in which sessions are signed with something
 * guessable. There is no default key, no dev key and no unsigned branch, for
 * exactly the reason the attribution token has none: the signature is the only
 * thing between "this request is partner A" and "this request says it is
 * partner A".
 */
export function resolvePartnerPlatformConfig(
  env: NodeJS.ProcessEnv = process.env,
): PartnerPlatformConfigResolution {
  if (!isAffiliatePlatformRequested(env)) {
    return { kind: "resolved", config: { enabled: false } };
  }
  const raw = env[PARTNER_SESSION_SECRET_KEY];
  const rejection = describeSecretRejection(raw, env);
  if (rejection !== null) return { kind: "invalid", reason: rejection };
  return { kind: "resolved", config: { enabled: true, sessionSecret: raw!.trim() } };
}

/**
 * The secret, for the session signer only.
 *
 * THROWS RATHER THAN RETURNS A FALLBACK. A caller that reached here with the
 * platform disabled or the secret unusable has a bug, and the only safe
 * response is to fail the request — a fallback key would mint tokens that
 * verify.
 */
export function getPartnerSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const resolution = resolvePartnerPlatformConfig(env);
  if (resolution.kind === "invalid" || !resolution.config.enabled) {
    throw new Error("PARTNER_PLATFORM_UNAVAILABLE");
  }
  return resolution.config.sessionSecret;
}
