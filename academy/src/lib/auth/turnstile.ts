/**
 * AFD-3A2 — the browser-side Cloudflare Turnstile contract.
 *
 * WHAT IS AND IS NOT AUTHORITATIVE HERE
 * Nothing in this file proves anything. The widget produces a token; the
 * Backend hands that token to Cloudflare's Siteverify endpoint and only
 * Cloudflare's answer decides. A determined caller can skip this code entirely
 * and POST to the Academy proxy by hand — which is fine, because the token they
 * do not have is the one the Backend requires. The widget exists to give an
 * honest visitor a way to obtain a real token, not to enforce anything.
 *
 * NO SITE KEY IS HARDCODED.
 * The key is public by definition, but baking one into product source pins every
 * deployment to one Cloudflare widget and makes rotation a code change. It
 * arrives at runtime from the server (see `src/config/academy-config.ts`) and is
 * passed down as a prop, so the same bundle serves DEV and production.
 */

/** The official script. Explicit rendering, so nothing renders until we ask. */
export const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The origin the script and its iframe are served from. */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * The action stamped on each Academy challenge.
 *
 * AFD-3A3: these are no longer advisory. The Backend pins one expected action
 * PER SURFACE in `src/lib/captcha/surface.ts` and refuses a token carrying any
 * other, so a token minted by the registration widget cannot log anybody in and
 * a token minted here cannot register anybody. The two sides must agree exactly;
 * these strings are the Academy half of that agreement.
 *
 * Cloudflare's limit is 32 characters of `[A-Za-z0-9_-]`.
 */
export const TURNSTILE_REGISTER_ACTION = "academy_register";
export const TURNSTILE_LOGIN_ACTION = "academy_login";

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

/** The minimal Content-Security-Policy allowances Turnstile requires. */
export const TURNSTILE_CSP_REQUIREMENTS = {
  "script-src": TURNSTILE_ORIGIN,
  "frame-src": TURNSTILE_ORIGIN,
  "connect-src": TURNSTILE_ORIGIN,
} as const;

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
