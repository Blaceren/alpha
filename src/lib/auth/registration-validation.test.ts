import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  normalizeName,
  passwordProblem,
  validateRegistrationDraft,
  hasFieldErrors,
  PASSWORD_MIN_LENGTH,
} from "@/lib/auth/registration-validation";

function draft(over: Partial<Parameters<typeof validateRegistrationDraft>[0]> = {}) {
  return {
    email: "learner@example.com",
    password: "Passw0rd",
    confirmPassword: "Passw0rd",
    name: "",
    ...over,
  };
}

describe("normalizeEmail — mirrors Backend .trim().toLowerCase()", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Learner@Example.COM ")).toBe("learner@example.com");
  });
});

describe("normalizeName — mirrors Backend .trim().min(1).optional()", () => {
  it("omits a blank name so Backend's .min(1) is never violated", () => {
    expect(normalizeName("")).toBeUndefined();
    expect(normalizeName("   ")).toBeUndefined();
  });

  it("trims a provided name", () => {
    expect(normalizeName("  Аня  ")).toBe("Аня");
  });
});

describe("passwordProblem — mirrors the Backend password policy", () => {
  it("accepts a compliant password", () => {
    expect(passwordProblem("Passw0rd")).toBeUndefined();
  });

  it("accepts the Cyrillic case classes Backend allows", () => {
    // Backend's refinements are /[A-ZА-Я]/ and /[a-zа-я]/.
    expect(passwordProblem("Пароль1")).toBeUndefined();
  });

  it(`requires at least ${PASSWORD_MIN_LENGTH} characters`, () => {
    expect(passwordProblem("Pa0")).toBeDefined();
  });

  it("requires an uppercase letter", () => {
    expect(passwordProblem("passw0rd")).toBeDefined();
  });

  it("requires a lowercase letter", () => {
    expect(passwordProblem("PASSW0RD")).toBeDefined();
  });

  it("requires a digit", () => {
    expect(passwordProblem("Password")).toBeDefined();
  });
});

describe("validateRegistrationDraft", () => {
  it("passes a valid draft", () => {
    expect(hasFieldErrors(validateRegistrationDraft(draft()))).toBe(false);
  });

  it("flags an invalid email", () => {
    for (const email of ["", "nope", "a@", "@b.co", "a b@c.co", "a@b", "a@b..co"]) {
      expect(validateRegistrationDraft(draft({ email })).email, email).toBeDefined();
    }
  });

  it("flags an invalid password", () => {
    expect(validateRegistrationDraft(draft({ password: "short", confirmPassword: "short" })).password)
      .toBeDefined();
  });

  it("flags a confirmation mismatch on the client-only field", () => {
    const errors = validateRegistrationDraft(draft({ confirmPassword: "Different1" }));
    expect(errors.confirmPassword).toBeDefined();
    expect(errors.password).toBeUndefined();
  });

  it("reports every failing field at once for an accessible error summary", () => {
    const errors = validateRegistrationDraft(
      draft({ email: "nope", password: "short", confirmPassword: "other" }),
    );
    expect(Object.keys(errors).sort()).toEqual(["confirmPassword", "email", "password"]);
  });
});
