/**
 * CAPTCHA contract for the Academy's anonymous surfaces — registration
 * (AFD-3A2) and login (AFD-3A3).
 *
 * ## What changed in AFD-3A2
 *
 * AFD-3A found the Backend `verifyCaptcha` to be a stub: `provider: "dev"`, no
 * verification call, and a bypass that was ON by default and ON for a MISSING
 * token. There was no site key, so this module reported `{ mode: "absent" }`
 * and the form deliberately sent nothing rather than fabricate the
 * `"dev-captcha-ok"` sentinel that the Backend's own legacy page ships.
 *
 * The Backend now has a real provider. Cloudflare Turnstile is verified
 * server-side against the fixed Siteverify endpoint, and registration fails
 * closed when it cannot be verified. So this module now resolves a real
 * contract from a runtime-injected site key.
 *
 * ## The site key is public, and still not hardcoded
 *
 * A Turnstile site key is designed to be read by anyone — it is in the page
 * source of every site that uses one. It is nonetheless injected at runtime
 * rather than compiled in, because a key in source pins every deployment to one
 * Cloudflare widget and turns rotation into a release. See
 * `src/config/academy-config.ts`; the SECRET counterpart never leaves the
 * Backend and is not readable from this package at all.
 *
 * ## Absent key is an unavailable state, never an open door
 *
 * If no key is configured the form says so and refuses to submit. It does NOT
 * hide the challenge and post anyway: the Backend would reject that with
 * `CAPTCHA_CONFIGURATION_ERROR`, so a hidden challenge buys nothing except a
 * confusing failure after the user has typed a password.
 */
import { isValidTurnstileSiteKey } from "@/lib/auth/turnstile";

/**
 * The exact optional field name in the Backend DTO.
 *
 * One name for both surfaces, because the Backend's `loginSchema` and the
 * `registerSchema` that extends it share it. Never a header, never a query
 * parameter: a token in a URL ends up in browser history, in a Referer and in
 * every access log between here and the Backend.
 */
export const CAPTCHA_TOKEN_FIELD = "captchaToken" as const;

export type CaptchaContract =
  /**
   * No usable site key reached the browser. The form renders an unavailable
   * state and blocks submission.
   */
  | { mode: "unavailable"; reason: "site_key_absent" | "site_key_malformed" }
  /** A provider is configured and its widget must be solved before submitting. */
  | { mode: "provider"; provider: "turnstile"; siteKey: string };

/**
 * Resolve the CAPTCHA contract available to the browser.
 *
 * A malformed key is reported separately from an absent one so an operator who
 * pasted a secret, a URL or a quoted value into `TURNSTILE_SITE_KEY` gets a
 * distinguishable diagnostic. Neither variant is ever a pass.
 */
export function resolveCaptchaContract(siteKey: string | null | undefined): CaptchaContract {
  if (siteKey === null || siteKey === undefined || siteKey.trim() === "") {
    return { mode: "unavailable", reason: "site_key_absent" };
  }
  const trimmed = siteKey.trim();
  if (!isValidTurnstileSiteKey(trimmed)) {
    return { mode: "unavailable", reason: "site_key_malformed" };
  }
  return { mode: "provider", provider: "turnstile", siteKey: trimmed };
}

/** Whether the registration form should render a CAPTCHA widget. */
export function hasCaptchaWidget(contract: CaptchaContract): boolean {
  return contract.mode === "provider";
}

/**
 * Whether a challenged form may be submitted at all.
 *
 * False when no provider is configured. The submit button is disabled rather
 * than allowed to post a request that cannot succeed.
 *
 * This is a USABILITY gate and never a security one — the Backend verifies the
 * token against Cloudflare on every request regardless of what any button here
 * does, and a caller who defeats the disabled attribute gains nothing but a
 * rejected request.
 */
export function canSubmitChallenge(contract: CaptchaContract, token: string | null): boolean {
  return contract.mode === "provider" && token !== null && token !== "";
}

/**
 * Registration's name for the same rule, kept so AFD-3A2's call sites and tests
 * read unchanged. AFD-3A3 added the Academy login surface, which uses the
 * general name.
 */
export const canSubmitRegistration = canSubmitChallenge;
