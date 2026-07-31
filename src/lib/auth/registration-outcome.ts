/**
 * Registration outcome mapping.
 *
 * Turns a `NormalizedError` from the Academy API client into one stable
 * registration state, and each state into one localized message. UI code never
 * renders a raw Backend string.
 *
 * ## The Backend response surface this maps (discovered in AFD-3A)
 *
 * | HTTP | body `error`        | meaning                              |
 * |------|---------------------|--------------------------------------|
 * | 201  | —                   | created                              |
 * | 400  | `VALIDATION_ERROR`  | DTO validation failed (+ `details`)  |
 * | 400  | `CAPTCHA_FAILED`    | captcha rejected                     |
 * | 400  | `REFERRAL_INVALID`  | unknown code / bonus config inactive |
 * | 400  | `Email уже занят`   | duplicate email                      |
 * | 429  | `RATE_LIMITED`      | 3 attempts / 30 min for this IP      |
 *
 * ## Why duplicate email is derived by elimination
 *
 * The duplicate-email branch is the ONE failure the owner returns without a
 * stable machine code — its `error` is a human Russian sentence. The Academy's
 * `readCode` deliberately drops non-code strings (`/^[A-Z0-9_]+$/`), so that
 * response arrives as "400 with no code", which no other branch of the owner
 * produces. Matching on the Russian sentence would be far worse: it would break
 * on any copy edit.
 *
 * This is a Backend contract weakness, not a safe invariant. It is recorded in
 * the AFD-3A audit as a follow-up (give the duplicate branch a stable
 * `EMAIL_TAKEN` code) and pinned by a test that reproduces the exact current
 * response, so the mapping fails loudly if the owner ever changes.
 */
import type { NormalizedError } from "@/lib/api/errors";

export type RegistrationFailure =
  | "EMAIL_TAKEN"
  | "CAPTCHA_FAILED"
  /** AFD-3A2: 503 — Cloudflare could not be reached or answered unusably. */
  | "CAPTCHA_UNAVAILABLE"
  /** AFD-3A2: 503 — this platform's CAPTCHA configuration is broken. */
  | "CAPTCHA_CONFIGURATION_ERROR"
  | "REFERRAL_INVALID"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "BACKEND_UNAVAILABLE"
  | "UNKNOWN";

const MESSAGES: Record<RegistrationFailure, string> = {
  EMAIL_TAKEN: "Этот email уже зарегистрирован. Войдите или используйте другой адрес.",
  CAPTCHA_FAILED: "Проверка не пройдена. Пройдите её ещё раз.",
  // Not the visitor's fault and not permanent: say so, and do not tell them to
  // re-solve a challenge that never reached the verifier.
  CAPTCHA_UNAVAILABLE: "Сервис проверки временно недоступен. Повторите попытку позже.",
  // Deliberately says nothing about which part of the configuration is wrong.
  CAPTCHA_CONFIGURATION_ERROR: "Проверка недоступна. Обратитесь к поддержке.",
  REFERRAL_INVALID: "Ссылка-приглашение недействительна. Зарегистрируйтесь по прямой ссылке.",
  VALIDATION_ERROR: "Проверьте введённые данные.",
  RATE_LIMITED: "Слишком много попыток регистрации. Попробуйте позже.",
  TIMEOUT: "Сервис не ответил вовремя. Повторите попытку.",
  BACKEND_UNAVAILABLE: "Сервис временно недоступен. Повторите попытку.",
  UNKNOWN: "Не удалось создать аккаунт. Повторите попытку.",
};

/**
 * Failures after which the CAPTCHA token must be discarded and a fresh one
 * obtained. A provider token is single-use and time-bounded, so replaying it
 * after any server-side rejection would fail a second time.
 */
const RENEWS_CAPTCHA: ReadonlySet<RegistrationFailure> = new Set<RegistrationFailure>([
  "CAPTCHA_FAILED",
  "CAPTCHA_UNAVAILABLE",
  "CAPTCHA_CONFIGURATION_ERROR",
  "RATE_LIMITED",
  "TIMEOUT",
  "BACKEND_UNAVAILABLE",
  "UNKNOWN",
]);

/**
 * Failures after which the entered password must be cleared.
 *
 * Only the duplicate-email case: the account already exists, so whatever was
 * typed is plausibly a real credential for it and must not sit in a form field
 * that the next screenshot, bug report or shoulder-surfer can read. Ordinary
 * validation failures keep the password so the user can fix one character.
 */
const CLEARS_PASSWORD: ReadonlySet<RegistrationFailure> = new Set<RegistrationFailure>([
  "EMAIL_TAKEN",
]);

export function mapRegistrationFailure(error: NormalizedError): RegistrationFailure {
  switch (error.category) {
    case "RATE_LIMITED":
      return "RATE_LIMITED";

    case "VALIDATION_ERROR":
      switch (error.code) {
        case "CAPTCHA_FAILED":
          return "CAPTCHA_FAILED";
        case "REFERRAL_INVALID":
          return "REFERRAL_INVALID";
        case "VALIDATION_ERROR":
          return "VALIDATION_ERROR";
        // A 400 the owner emitted without a stable code: duplicate email.
        case null:
          return "EMAIL_TAKEN";
        default:
          return "VALIDATION_ERROR";
      }

    case "CONFLICT":
      return "EMAIL_TAKEN";

    case "NETWORK_ERROR":
    case "BACKEND_UNAVAILABLE":
    case "CONFIGURATION_ERROR":
      // AFD-3A2. The Backend answers 503 for a CAPTCHA outage and for a broken
      // CAPTCHA configuration, which `categoryForStatus` maps to
      // BACKEND_UNAVAILABLE. The stable code distinguishes them, so a visitor
      // who hit a Cloudflare outage is not told "the service is unavailable"
      // when the specific, actionable truth is available.
      switch (error.code) {
        case "CAPTCHA_UNAVAILABLE":
          return "CAPTCHA_UNAVAILABLE";
        case "CAPTCHA_CONFIGURATION_ERROR":
          return "CAPTCHA_CONFIGURATION_ERROR";
        default:
          return "BACKEND_UNAVAILABLE";
      }

    default:
      return "UNKNOWN";
  }
}

export function registrationMessage(failure: RegistrationFailure): string {
  return MESSAGES[failure];
}

export function shouldRenewCaptcha(failure: RegistrationFailure): boolean {
  return RENEWS_CAPTCHA.has(failure);
}

export function shouldClearPassword(failure: RegistrationFailure): boolean {
  return CLEARS_PASSWORD.has(failure);
}
