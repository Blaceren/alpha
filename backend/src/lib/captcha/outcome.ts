/**
 * AFD-3A2 — the stable internal CAPTCHA outcome, and its public projection.
 *
 * Two vocabularies, deliberately not merged:
 *
 *   CaptchaOutcome  — what actually happened. Ten values. Used by audit rows,
 *                     operator diagnostics and tests.
 *   CaptchaPublicCode — what an anonymous browser is told. Three values.
 *
 * The projection is lossy ON PURPOSE. An unauthenticated caller learns whether
 * to try again, and nothing else. In particular `provider_misconfigured` — which
 * is emitted when OUR secret is missing, empty, wrong or revoked — collapses
 * into one generic configuration error that says the same thing for all four,
 * so probing the endpoint cannot tell an attacker which of them is true.
 */

/** Every distinguishable result of asking "is this challenge genuine?". */
export type CaptchaOutcome =
  | "success"
  | "missing_token"
  | "invalid_token"
  | "expired_or_duplicate"
  | "provider_unavailable"
  | "provider_timeout"
  | "provider_misconfigured"
  | "hostname_mismatch"
  | "action_mismatch"
  | "malformed_provider_response"
  /**
   * AFD-3A3. The request reached an enforced surface without a trusted server
   * having named which surface it is, so there is no action to check the token
   * against. Reported as a platform configuration fault because that is what it
   * is: the fronting proxy failed to stamp a header only it can stamp.
   */
  | "surface_unresolved";

/** The only three codes an anonymous browser ever sees. */
export type CaptchaPublicCode =
  | "CAPTCHA_FAILED"
  | "CAPTCHA_UNAVAILABLE"
  | "CAPTCHA_CONFIGURATION_ERROR";

/**
 * HTTP status per public code.
 *
 * `CAPTCHA_FAILED` keeps 400 — the pre-existing status for this envelope, so
 * the AFD-3A Academy success/failure handling is unchanged.
 *
 * The other two are 503 rather than 400 because they are not the visitor's
 * fault and they are not permanent. Reporting a provider outage as a client
 * validation error would tell the person to fix input they got right, and would
 * tell monitoring that users are failing challenges when in fact the platform
 * is broken.
 */
export const CAPTCHA_PUBLIC_STATUS: Record<CaptchaPublicCode, number> = {
  CAPTCHA_FAILED: 400,
  CAPTCHA_UNAVAILABLE: 503,
  CAPTCHA_CONFIGURATION_ERROR: 503,
};

/**
 * Public Russian messages, matching the established message conventions of the
 * auth routes. None mentions Turnstile, Cloudflare, a hostname, an action, a
 * secret or a token.
 */
export const CAPTCHA_PUBLIC_MESSAGE: Record<CaptchaPublicCode, string> = {
  CAPTCHA_FAILED: "Проверка не пройдена. Пройдите её ещё раз.",
  CAPTCHA_UNAVAILABLE: "Сервис проверки временно недоступен. Повторите попытку позже.",
  CAPTCHA_CONFIGURATION_ERROR: "Проверка недоступна. Обратитесь к поддержке.",
};

export function captchaPublicCode(outcome: Exclude<CaptchaOutcome, "success">): CaptchaPublicCode {
  switch (outcome) {
    case "missing_token":
    case "invalid_token":
    case "expired_or_duplicate":
    // A hostname or action mismatch means the token is real but was not minted
    // for this submission. To the person at the keyboard that is indistinguishable
    // from a stale challenge, and "try again" is the correct advice — so it is
    // reported as a failed check rather than hinting at the pinned allow-list.
    case "hostname_mismatch":
    case "action_mismatch":
      return "CAPTCHA_FAILED";

    case "provider_timeout":
    case "provider_unavailable":
    case "malformed_provider_response":
      return "CAPTCHA_UNAVAILABLE";

    case "provider_misconfigured":
    // Indistinguishable from a missing secret to the anonymous browser, and for
    // the same reason: both mean this deployment cannot currently verify anyone,
    // and neither is something the visitor can act on beyond contacting support.
    case "surface_unresolved":
      return "CAPTCHA_CONFIGURATION_ERROR";
  }
}

/**
 * Whether the browser must discard its token and obtain a fresh one.
 *
 * Turnstile tokens are single-use and expire after five minutes, so anything
 * that consumed or invalidated the token requires a widget reset. A pure
 * platform configuration error did not consume it — but the widget is reset
 * there too, because by the time the operator fixes the configuration the token
 * will very likely have aged out anyway, and a reset is never harmful.
 */
export function requiresFreshToken(outcome: Exclude<CaptchaOutcome, "success">): boolean {
  return outcome !== "missing_token";
}
