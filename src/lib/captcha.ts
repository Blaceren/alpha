/**
 * AFD-3A2 / AFD-3A3 — CAPTCHA verification.
 *
 * WHAT THIS FILE USED TO BE
 * A stub. `provider: "dev"`, no integration, and one line of policy:
 * `CAPTCHA_DEV_BYPASS !== "false"` — bypass ON unless explicitly disabled, ON
 * for a MISSING token, and ON for every typo of "false". The key was absent
 * from the DEV runtime, so every registration and login passed unchallenged.
 * `CAPTCHA_DEV_BYPASS` is now removed from the environment contract entirely;
 * nothing reads it and setting it grants nothing.
 *
 * WHAT IT IS NOW
 * A purpose-aware gate over one real provider (see `captcha/provider.ts`) and
 * one real server-side verification (see `captcha/siteverify.ts`).
 *
 * REGISTRATION IS UNCONDITIONALLY ENFORCED.
 * There is no environment, flag, header, query parameter or token value that
 * makes `purpose: "register"` skip verification. An unconfigured provider does
 * not open the door — it closes it, with a configuration error.
 *
 * LOGIN IS NOW A REAL SURFACE (AFD-3A3).
 * AFD-3A2 could not enforce login: the Academy and CRM login pages had no
 * widget, so switching enforcement on would have locked out the learner and the
 * CRM administrator rather than protecting them. Both pages now render a real
 * challenge and both fronting servers stamp which surface they are, so login is
 * verified wherever `isCaptchaLoginEnforced` says it must be — and the legacy
 * `"dev-captcha-ok"` sentinel that used to stand in for a token is gone from the
 * source entirely.
 *
 * The remaining unverified-login path is exactly one place: an explicit
 * `ATA_ENVIRONMENT=dev` box that has not set `CAPTCHA_LOGIN_ENFORCED`.
 * `validateRuntimeEnv` refuses to start anything else without it, so a
 * production host that forgets to think about login fails to boot rather than
 * quietly accepting anyone.
 *
 * EVERY ENFORCED VERIFICATION IS PINNED TO A SURFACE.
 * A token is evidence about ONE form. `captcha/surface.ts` records which action
 * each form's widget stamps, and a verification that cannot name its surface
 * fails as a configuration error. See that file for why the surface is a
 * proxy-stamped header and not a body field.
 */
import {
  captchaPublicCode,
  requiresFreshToken,
  CAPTCHA_PUBLIC_MESSAGE,
  CAPTCHA_PUBLIC_STATUS,
  type CaptchaOutcome,
  type CaptchaPublicCode,
} from "@/lib/captcha/outcome";
import {
  describeCaptchaConfigRejection,
  isCaptchaLoginEnforced,
  isCaptchaProviderRequired,
  resolveCaptchaConfig,
  type CaptchaProviderName,
} from "@/lib/captcha/provider";
import { verifyTurnstileToken, type SiteverifyFetch } from "@/lib/captcha/siteverify";
import type { AuthSurface } from "@/lib/captcha/surface";
import { getRequestIp } from "@/lib/rateLimit";

export type { CaptchaPurpose } from "@/lib/captcha/purpose";
import type { CaptchaPurpose } from "@/lib/captcha/purpose";

export { CAPTCHA_LOGIN_ENFORCED_KEY, isCaptchaLoginEnforced } from "@/lib/captcha/provider";

/** Purposes whose verification is unconditional, whatever the configuration says. */
const ALWAYS_ENFORCED: ReadonlySet<CaptchaPurpose> = new Set<CaptchaPurpose>(["register"]);

export type CaptchaVerificationInput = {
  token?: string | null;
  purpose: CaptchaPurpose;
  /**
   * Which form this challenge was raised for (AFD-3A3). Supplies the expected
   * Turnstile action. `null` when a fronting server did not name one — that is a
   * refusal, never a skipped comparison. Callers with exactly one surface (the
   * registration owner) pass a source constant and can never be `null`.
   */
  surface?: AuthSurface | null;
  request?: Request;
  /** Test seam. Never set in product code. */
  env?: NodeJS.ProcessEnv;
  /** Test seam. Never set in product code. */
  fetchImpl?: SiteverifyFetch;
};

export type CaptchaVerificationResult =
  | {
      readonly ok: true;
      readonly outcome: "success";
      /** `"unenforced"` marks the declared DEV-only login exception. */
      readonly provider: CaptchaProviderName | "unenforced";
    }
  | {
      readonly ok: false;
      readonly outcome: Exclude<CaptchaOutcome, "success">;
      readonly code: CaptchaPublicCode;
      readonly status: number;
      readonly message: string;
      /** Whether the browser must reset its widget before retrying. */
      readonly renewToken: boolean;
    };

/** Is this purpose verified in this environment? */
export function isCaptchaEnforced(
  purpose: CaptchaPurpose,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (ALWAYS_ENFORCED.has(purpose)) return true;
  return isCaptchaLoginEnforced(env) || isCaptchaProviderRequired(env);
}

function failure(outcome: Exclude<CaptchaOutcome, "success">): CaptchaVerificationResult {
  const code = captchaPublicCode(outcome);
  return {
    ok: false,
    outcome,
    code,
    status: CAPTCHA_PUBLIC_STATUS[code],
    message: CAPTCHA_PUBLIC_MESSAGE[code],
    renewToken: requiresFreshToken(outcome),
  };
}

/**
 * Verify one challenge.
 *
 * Ordering matters and is deliberate:
 *   1. enforcement — is this purpose gated here at all?
 *   2. surface — which form is this, and therefore which action is acceptable?
 *   3. configuration — refuse before touching the network if we cannot verify;
 *   4. token presence — refuse before spending a provider round trip;
 *   5. provider — the only authority that can answer "yes".
 *
 * The surface check precedes the token check so that a deployment whose proxy
 * is not stamping the header reports a configuration fault to its operator
 * instead of a wall of "you failed the challenge" at honest visitors.
 *
 * The token is never logged, never audited and never echoed. Neither is the
 * secret, which this function does not even name — it lives inside the resolved
 * config and is read only by the Siteverify client.
 */
export async function verifyCaptcha(
  input: CaptchaVerificationInput,
): Promise<CaptchaVerificationResult> {
  const env = input.env ?? process.env;

  if (!isCaptchaEnforced(input.purpose, env)) {
    return { ok: true, outcome: "success", provider: "unenforced" };
  }

  const surface = input.surface ?? null;
  if (surface === null) return failure("surface_unresolved");
  // Belt and braces: a caller could in principle hand over a surface belonging
  // to another purpose. The registry says which purpose owns which surface, and
  // disagreeing with it is a refusal rather than a reinterpretation.
  if (surface.purpose !== input.purpose) return failure("surface_unresolved");

  const resolution = resolveCaptchaConfig(env);
  if (!resolution.configured) {
    // Deliberately identical for "no provider chosen", "secret missing",
    // "secret empty" and "secret is a placeholder". The operator learns which
    // from `describeCaptchaConfigRejection` at startup and in preflight; the
    // anonymous browser learns only that the platform, not the visitor, is at
    // fault. There is no fallback branch: this returns closed.
    return failure("provider_misconfigured");
  }

  const token = typeof input.token === "string" ? input.token.trim() : "";
  if (token === "") return failure("missing_token");

  const verdict = await verifyTurnstileToken({
    config: resolution.config,
    token,
    expectedAction: surface.action,
    // The canonical trusted resolver, and only it. A browser-supplied
    // `x-forwarded-for` is never read here — see AFD-3A's client-IP contract
    // for why the Academy proxy overwrites rather than appends to that chain.
    remoteIp: input.request ? getRequestIp(input.request) : null,
    fetchImpl: input.fetchImpl,
  });

  if (verdict.kind === "success") {
    return { ok: true, outcome: "success", provider: resolution.config.provider };
  }
  return failure(verdict.kind);
}

/**
 * Operator-facing configuration report. Used by startup validation.
 * Returns `null` when the configuration is usable.
 */
export function describeCaptchaConfigurationProblem(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const resolution = resolveCaptchaConfig(env);
  return resolution.configured ? null : describeCaptchaConfigRejection(resolution.reason);
}
