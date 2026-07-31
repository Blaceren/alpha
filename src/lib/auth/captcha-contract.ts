/**
 * CAPTCHA contract for the public registration surface.
 *
 * ## Authoritative state of the Backend contract (discovered in AFD-3A)
 *
 * `src/lib/captcha.ts` in the Backend is a **stub with no provider**:
 *
 *   - the result type hard-codes `provider: "dev"` — there is no Turnstile,
 *     hCaptcha or reCAPTCHA integration anywhere in the Backend;
 *   - `CAPTCHA_DEV_BYPASS !== "false"` means bypass is ON unless explicitly
 *     disabled, and the key is not set in the DEV runtime, so bypass is on;
 *   - while bypass is on, verification succeeds for a MISSING token or for the
 *     literal sentinel `"dev-captcha-ok"`;
 *   - while bypass is off, verification fails unconditionally — there is no
 *     provider to verify against, so registration becomes impossible rather
 *     than protected.
 *
 * There is consequently **no public site key**, no server secret, no widget
 * contract and no verification endpoint. A real CAPTCHA cannot be integrated
 * from the Academy alone; the Backend must gain a provider first. AFD-3A is
 * explicitly forbidden from creating or rotating CAPTCHA credentials, so this
 * is reported as a blocker rather than papered over.
 *
 * ## What the Academy does about it
 *
 * It sends **no** `captchaToken`.
 *
 * The alternative — hard-coding `"dev-captcha-ok"`, which the Backend's own
 * legacy `/register` page does — would ship a fabricated client-generated
 * success token inside a PUBLIC browser bundle. That is a forbidden fake
 * success token, and it is not even load-bearing: with bypass on, an absent
 * token already passes; with bypass off, the sentinel fails too. Omitting the
 * field is behaviourally identical and honest.
 *
 * `captchaToken` is optional in the authoritative request DTO, so omitting it
 * is exactly DTO-conformant.
 *
 * ## Insertion point for a real provider
 *
 * When the Backend gains a provider, this module returns
 * `{ mode: "provider", provider, siteKey }`, the form renders that provider's
 * widget, and the resulting token is passed to `api.register({ captchaToken })`
 * — which already accepts and forwards it. No other file needs to change. The
 * site key is public by definition and would arrive as a `NEXT_PUBLIC_*` value;
 * the secret stays server-side in the Backend and never reaches this package.
 */

/** The exact optional field name in the Backend registration DTO. */
export const CAPTCHA_TOKEN_FIELD = "captchaToken" as const;

export type CaptchaContract =
  /**
   * No provider exists in the authoritative Backend. The form renders no
   * widget and sends no token.
   */
  | { mode: "absent" }
  /** Reserved for a real provider. Not reachable today — see the note above. */
  | { mode: "provider"; provider: string; siteKey: string };

/**
 * Resolve the CAPTCHA contract available to the browser.
 *
 * Returns `{ mode: "absent" }` because the Backend exposes no provider. This is
 * a deliberate, discovered fact rather than a default: see the module comment.
 */
export function resolveCaptchaContract(): CaptchaContract {
  return { mode: "absent" };
}

/**
 * Whether the registration form should render a CAPTCHA widget.
 *
 * Kept as a named predicate so the form has one obvious branch to extend and so
 * tests can assert that today's public bundle renders no widget and fabricates
 * no token.
 */
export function hasCaptchaWidget(contract: CaptchaContract): boolean {
  return contract.mode === "provider";
}
