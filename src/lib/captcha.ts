/**
 * AFD-3A2 — CAPTCHA verification.
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
 * LOGIN AND CHECKPOINT ARE A DECLARED, BOUNDED EXCEPTION.
 * AFD-3A2 owns the registration surface. The login surfaces still submit the
 * legacy hard-coded `"dev-captcha-ok"` sentinel from pages this phase is not
 * permitted to change, so enforcing Turnstile on login here would lock the
 * primary learner and the CRM administrator out of the live DEV deployment on
 * the day it shipped — a regression, not a hardening.
 *
 * That exception is NOT a default bypass, because it cannot survive a real
 * deployment: `isCaptchaLoginEnforced` is required to be true anywhere that is
 * not an explicit `ATA_ENVIRONMENT=dev` box, and `validateRuntimeEnv` refuses to
 * start such a deployment without it. So the unverified login path exists in
 * exactly one place — a developer machine — and a production host that forgets
 * to think about it fails to boot rather than quietly accepting anyone.
 *
 * Migrating the login surfaces to a widget is tracked as follow-up AFD-3A3.
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
import { getRequestIp } from "@/lib/rateLimit";

export type CaptchaPurpose = "login" | "register" | "checkpoint";

export { CAPTCHA_LOGIN_ENFORCED_KEY, isCaptchaLoginEnforced } from "@/lib/captcha/provider";

/** Purposes whose verification is unconditional, whatever the configuration says. */
const ALWAYS_ENFORCED: ReadonlySet<CaptchaPurpose> = new Set<CaptchaPurpose>(["register"]);

export type CaptchaVerificationInput = {
  token?: string | null;
  purpose: CaptchaPurpose;
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
 *   2. configuration — refuse before touching the network if we cannot verify;
 *   3. token presence — refuse before spending a provider round trip;
 *   4. provider — the only authority that can answer "yes".
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
