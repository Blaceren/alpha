import { describe, it, expect } from "vitest";
import { normalizeHttpError, makeError } from "@/lib/api/errors";
import {
  mapRegistrationFailure,
  registrationMessage,
  shouldClearPassword,
  shouldRenewCaptcha,
  type RegistrationFailure,
} from "@/lib/auth/registration-outcome";

/**
 * Each case reproduces the EXACT body the Backend registration owner returns,
 * so this suite fails loudly if that contract ever changes.
 */
describe("mapRegistrationFailure — real Backend responses", () => {
  it("429 RATE_LIMITED", () => {
    const error = normalizeHttpError({
      status: 429,
      body: { error: "RATE_LIMITED", message: "Слишком много запросов. Попробуйте позже." },
    });
    expect(mapRegistrationFailure(error)).toBe("RATE_LIMITED");
  });

  it("400 VALIDATION_ERROR with details", () => {
    const error = normalizeHttpError({
      status: 400,
      body: {
        error: "VALIDATION_ERROR",
        message: "Некорректные данные запроса",
        details: [{ field: "password", message: "Пароль должен содержать цифру" }],
      },
    });
    expect(mapRegistrationFailure(error)).toBe("VALIDATION_ERROR");
  });

  it("400 CAPTCHA_FAILED", () => {
    const error = normalizeHttpError({
      status: 400,
      body: { error: "CAPTCHA_FAILED", message: "Captcha не пройдена" },
    });
    expect(mapRegistrationFailure(error)).toBe("CAPTCHA_FAILED");
  });

  it("400 REFERRAL_INVALID", () => {
    const error = normalizeHttpError({
      status: 400,
      body: { error: "REFERRAL_INVALID", message: "Реферальная ссылка недействительна" },
    });
    expect(mapRegistrationFailure(error)).toBe("REFERRAL_INVALID");
  });

  it("400 duplicate email — the one branch with no stable code", () => {
    // Backend returns `{ error: "Email уже занят" }`. The Academy's readCode
    // drops non-code strings, so this arrives as a 400 with code === null. That
    // is the discriminator; we never match on the Russian sentence.
    const error = normalizeHttpError({ status: 400, body: { error: "Email уже занят" } });
    expect(error.code).toBeNull();
    expect(mapRegistrationFailure(error)).toBe("EMAIL_TAKEN");
  });

  it("502 from the proxy — Backend unreachable or timed out", () => {
    expect(mapRegistrationFailure(normalizeHttpError({ status: 502 }))).toBe("BACKEND_UNAVAILABLE");
  });

  it("client-side network failure", () => {
    expect(mapRegistrationFailure(makeError("NETWORK_ERROR"))).toBe("BACKEND_UNAVAILABLE");
  });

  it("proxy configuration failure is not shown as a user data problem", () => {
    expect(mapRegistrationFailure(makeError("CONFIGURATION_ERROR"))).toBe("BACKEND_UNAVAILABLE");
  });

  it("an unrecognized failure degrades to a bounded generic state", () => {
    expect(mapRegistrationFailure(normalizeHttpError({ status: 418 }))).toBe("UNKNOWN");
    expect(mapRegistrationFailure(makeError("MALFORMED_RESPONSE"))).toBe("UNKNOWN");
  });
});

describe("registration messages", () => {
  const ALL: RegistrationFailure[] = [
    "EMAIL_TAKEN",
    "CAPTCHA_FAILED",
    "REFERRAL_INVALID",
    "VALIDATION_ERROR",
    "RATE_LIMITED",
    "TIMEOUT",
    "BACKEND_UNAVAILABLE",
    "UNKNOWN",
  ];

  it("every state has a non-empty localized message", () => {
    for (const failure of ALL) {
      expect(registrationMessage(failure).length, failure).toBeGreaterThan(0);
    }
  });

  it("no message leaks a raw Backend string or an internal detail", () => {
    for (const failure of ALL) {
      const message = registrationMessage(failure);
      expect(message).not.toContain("VALIDATION_ERROR");
      expect(message).not.toContain("127.0.0.1");
      expect(message).not.toMatch(/stack|Error:|at \w+ \(/);
    }
  });
});

describe("post-failure hygiene", () => {
  it("renews the CAPTCHA after any server-side rejection", () => {
    expect(shouldRenewCaptcha("CAPTCHA_FAILED")).toBe(true);
    expect(shouldRenewCaptcha("RATE_LIMITED")).toBe(true);
    expect(shouldRenewCaptcha("TIMEOUT")).toBe(true);
    expect(shouldRenewCaptcha("BACKEND_UNAVAILABLE")).toBe(true);
  });

  it("keeps a token that a local validation failure never spent", () => {
    expect(shouldRenewCaptcha("VALIDATION_ERROR")).toBe(false);
  });

  it("clears the password when the account already exists", () => {
    expect(shouldClearPassword("EMAIL_TAKEN")).toBe(true);
  });

  it("keeps the password for a recoverable validation failure", () => {
    expect(shouldClearPassword("VALIDATION_ERROR")).toBe(false);
    expect(shouldClearPassword("RATE_LIMITED")).toBe(false);
  });
});
