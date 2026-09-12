/**
 * AFD-3A3 — how a login failure is shown, and when the challenge is renewed.
 *
 * Two decisions live here, both of which the form would otherwise make inline
 * and inconsistently:
 *
 *   1. WHICH MESSAGE. Wrong password, unknown account and a blocked account
 *      collapse into one sentence, because the Backend deliberately answers 401
 *      for the first two and this surface must not undo that. A CAPTCHA failure
 *      is reported as a CAPTCHA failure rather than as bad credentials — telling
 *      someone their password is wrong when the challenge lapsed sends them to
 *      reset a password that was fine.
 *
 *   2. WHETHER TO RENEW THE CHALLENGE. Turnstile tokens are single-use. Any
 *      attempt that reached Backend CAPTCHA validation has spent its token,
 *      whatever the answer was, so retrying with the same one can only produce
 *      `timeout-or-duplicate`. That includes an INVALID-PASSWORD response: the
 *      challenge was verified before the password was compared, so the token is
 *      gone even though the failure had nothing to do with it.
 */
import type { NormalizedError, ErrorCategory } from "@/lib/api/errors";

export type LoginFailure =
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_BLOCKED"
  | "EMAIL_NOT_VERIFIED"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "CAPTCHA_FAILED"
  | "CAPTCHA_UNAVAILABLE"
  | "CAPTCHA_CONFIGURATION_ERROR"
  | "BACKEND_UNAVAILABLE"
  | "TIMEOUT"
  | "UNKNOWN";

/**
 * Generic, account-enumeration-safe copy. No raw Backend string is ever shown,
 * and no message distinguishes "no such account" from "wrong password".
 */
export const LOGIN_FAILURE_MESSAGE: Record<LoginFailure, string> = {
  INVALID_CREDENTIALS: "Неверный email или пароль.",
  // A blocked account is a 403 with a stable code, so it is safe to be specific:
  // the person already knows the account exists — they own it.
  ACCOUNT_BLOCKED: "Аккаунт заблокирован. Обратитесь к поддержке.",
  EMAIL_NOT_VERIFIED: "Подтвердите email перед входом.",
  VALIDATION_ERROR: "Проверьте введённые данные.",
  RATE_LIMITED: "Слишком много попыток. Попробуйте позже.",
  CAPTCHA_FAILED: "Проверка не пройдена. Пройдите её ещё раз.",
  CAPTCHA_UNAVAILABLE: "Сервис проверки временно недоступен. Повторите попытку позже.",
  CAPTCHA_CONFIGURATION_ERROR: "Вход временно недоступен. Обратитесь к поддержке.",
  BACKEND_UNAVAILABLE: "Сервис временно недоступен. Повторите попытку.",
  TIMEOUT: "Превышено время ожидания. Повторите попытку.",
  UNKNOWN: "Не удалось войти. Повторите попытку.",
};

/** The three CAPTCHA codes the Backend emits. Anything else is not a CAPTCHA fault. */
const CAPTCHA_CODES = new Set([
  "CAPTCHA_FAILED",
  "CAPTCHA_UNAVAILABLE",
  "CAPTCHA_CONFIGURATION_ERROR",
]);

/**
 * Map a normalized transport error onto a login failure.
 *
 * The Backend's stable `error` code is consulted FIRST, because the status alone
 * is ambiguous: 400 covers both a malformed body and a rejected challenge, and
 * 503 covers both a provider outage and a broken configuration.
 */
export function mapLoginFailure(error: NormalizedError): LoginFailure {
  if (error.code !== null && CAPTCHA_CODES.has(error.code)) {
    return error.code as LoginFailure;
  }
  if (error.code === "ACCOUNT_BLOCKED") return "ACCOUNT_BLOCKED";
  if (error.code === "EMAIL_NOT_VERIFIED") return "EMAIL_NOT_VERIFIED";

  const byCategory: Partial<Record<ErrorCategory, LoginFailure>> = {
    INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
    UNAUTHENTICATED: "INVALID_CREDENTIALS",
    // A 403 with no recognised code is still not a hint about the password.
    FORBIDDEN: "INVALID_CREDENTIALS",
    VALIDATION_ERROR: "VALIDATION_ERROR",
    RATE_LIMITED: "RATE_LIMITED",
    NETWORK_ERROR: "BACKEND_UNAVAILABLE",
    BACKEND_UNAVAILABLE: "BACKEND_UNAVAILABLE",
    CONFIGURATION_ERROR: "CAPTCHA_CONFIGURATION_ERROR",
  };
  return byCategory[error.category] ?? "UNKNOWN";
}

/**
 * Failures after which the widget must issue a brand-new challenge.
 *
 * This is nearly everything, and deliberately so. The only exclusions are
 * failures that were decided BEFORE the request reached Backend CAPTCHA
 * validation, where the token is provably still unspent:
 *
 *   - VALIDATION_ERROR — the body was rejected by the schema, which runs first;
 *   - RATE_LIMITED — refused ahead of verification, so the token was untouched;
 *   - BACKEND_UNAVAILABLE and TIMEOUT — the request may never have arrived.
 *
 * Renewing on those too would be harmless but wasteful; NOT renewing on any of
 * the others would guarantee the next attempt fails as a replay.
 */
const KEEPS_TOKEN: ReadonlySet<LoginFailure> = new Set<LoginFailure>([
  "VALIDATION_ERROR",
  "RATE_LIMITED",
  "BACKEND_UNAVAILABLE",
  "TIMEOUT",
]);

export function shouldRenewCaptcha(failure: LoginFailure): boolean {
  return !KEEPS_TOKEN.has(failure);
}

/** Whether the password field should be cleared. Never the email. */
export function shouldClearPassword(failure: LoginFailure): boolean {
  return failure === "INVALID_CREDENTIALS";
}
