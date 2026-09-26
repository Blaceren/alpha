import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  nameProblem,
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
    name: "Учащийся",
    ...over,
  };
}

describe("normalizeEmail — mirrors Backend .trim().toLowerCase()", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Learner@Example.COM ")).toBe("learner@example.com");
  });
});

describe("normalizeName — mirrors Backend nameSchema: trimmed, 2..50, required", () => {
  it("omits a blank name so Backend's .min(1) is never violated", () => {
    expect(normalizeName("")).toBe("");
    expect(normalizeName("   ")).toBe("");
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

  it("asks for no character category at all", () => {
    /* Each of these used to be rejected by a refinement that no longer exists,
       and each is now a password the Backend accepts. */
    for (const password of ["passw0rd", "PASSW0RD", "Password", "abcdef", "123456", "пароль"]) {
      expect(passwordProblem(password), password).toBeUndefined();
    }
  });

  it("measures the value as typed, without trimming it", () => {
    expect(passwordProblem("  abcd  ")).toBeUndefined();
    expect(passwordProblem("  a  ")).toBeDefined();
  });
});

describe("nameProblem — the mirror of Backend nameSchema", () => {
  it("requires a name", () => {
    expect(nameProblem("")).toBe("Укажите имя.");
    expect(nameProblem("   ")).toBe("Укажите имя.");
  });

  it("measures after trimming", () => {
    expect(nameProblem("  Я  ")).toBeDefined();
    expect(nameProblem("  Ян  ")).toBeUndefined();
  });

  it("accepts both ends of the range and refuses past it", () => {
    expect(nameProblem("и".repeat(2))).toBeUndefined();
    expect(nameProblem("и".repeat(50))).toBeUndefined();
    expect(nameProblem("и".repeat(51))).toBeDefined();
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
      draft({ email: "nope", name: "", password: "short", confirmPassword: "other" }),
    );
    expect(Object.keys(errors).sort()).toEqual(["confirmPassword", "email", "name", "password"]);
  });
});
