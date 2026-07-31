/**
 * AFD-3A3 — the browser-side Cloudflare Turnstile contract for the CRM.
 *
 * WHAT IS AND IS NOT AUTHORITATIVE HERE
 * Nothing in this file proves anything. The widget produces a token; the CRM
 * login route forwards it to the backend, and the backend hands it to
 * Cloudflare's Siteverify endpoint. Only Cloudflare's answer decides, and the
 * backend additionally requires the action stamped on the token to be exactly
 * `crm_login`. A determined caller can skip this code and POST to
 * `/api/crm/auth/login` by hand — which is fine, because the token they do not
 * have is the one the backend requires.
 *
 * NO SITE KEY IS HARDCODED, AND NO SECRET EXISTS IN THIS PACKAGE.
 * The site key is public by definition but arrives at runtime from the server
 * (see `src/config/turnstile.ts`), so one build serves every deployment and
 * rotating the widget is not a release. The SECRET counterpart lives only in the
 * backend and is not readable from the CRM at all.
 *
 * This mirrors the Academy's `src/lib/auth/turnstile.ts` deliberately rather
 * than sharing a package: the two applications have no shared module boundary,
 * and a copied 40-line contract is cheaper to keep honest than a new dependency
 * between two independently deployed frontends. The ACTION differs, which is the
 * whole point — see the backend's `captcha/surface.ts`.
 */

/** The official script. Explicit rendering, so nothing renders until we ask. */
export const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The origin the script and its iframe are served from. */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * The action stamped on the CRM login challenge.
 *
 * The backend refuses an `academy_login` or `academy_register` token here, and
 * refuses this one there. Cloudflare's limit is 32 characters of `[A-Za-z0-9_-]`.
 */
export const TURNSTILE_CRM_LOGIN_ACTION = "crm_login";

/**
 * A conservative site-key shape: a leading digit, `x`, then key material.
 * Real keys look like `0x4AAA…`; Cloudflare's published test keys look like
 * `1x0000…AA`. Both pass; an empty string, a stray quote, a URL or a secret
 * pasted into the wrong variable do not.
 */
const SITE_KEY_PATTERN = /^[0-9]x[A-Za-z0-9_-]{10,60}$/;

export function isValidTurnstileSiteKey(value: string): boolean {
  return SITE_KEY_PATTERN.test(value);
}

/** The subset of the `window.turnstile` API this application uses. */
export type TurnstileRenderOptions = {
  sitekey: string;
  action: string;
  callback: (token: string) => void;
  "error-callback": (code?: string) => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
  theme?: "auto" | "light" | "dark";
  size?: "normal" | "flexible" | "compact";
};

export type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string | undefined;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export type CaptchaContract =
  /**
   * No usable site key reached the browser. The form renders an unavailable
   * state and blocks submission.
   */
  | { mode: "unavailable"; reason: "site_key_absent" | "site_key_malformed" }
  /** A provider is configured and its widget must be solved before submitting. */
  | { mode: "provider"; siteKey: string };

/**
 * Resolve the contract available to the browser.
 *
 * A malformed key is reported separately from an absent one so an operator who
 * pasted a secret, a URL or a quoted value into `TURNSTILE_SITE_KEY` gets a
 * distinguishable diagnostic. Neither variant is ever a pass: an absent key
 * renders an unavailable state rather than hiding the challenge and posting
 * anyway, because the backend would refuse that with a configuration error after
 * the employee had already typed a password.
 */
export function resolveCaptchaContract(siteKey: string | null | undefined): CaptchaContract {
  if (siteKey === null || siteKey === undefined || siteKey.trim() === "") {
    return { mode: "unavailable", reason: "site_key_absent" };
  }
  const trimmed = siteKey.trim();
  if (!isValidTurnstileSiteKey(trimmed)) {
    return { mode: "unavailable", reason: "site_key_malformed" };
  }
  return { mode: "provider", siteKey: trimmed };
}

/** Whether submission may be attempted at all. A usability gate, never a control. */
export function canSubmitChallenge(contract: CaptchaContract, token: string | null): boolean {
  return contract.mode === "provider" && token !== null && token !== "";
}
