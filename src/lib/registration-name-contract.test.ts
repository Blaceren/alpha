import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { REGISTRATION_NAME_BRIDGE, registerSchema } from "@/lib/validation";

/**
 * THE NAME CONTRACT THIS BUILD CARRIES — and it is the BRIDGE, not the end.
 *
 * ATA-PROFILE-FOUNDATION-1 cannot ship its two halves in either order. A strict
 * Backend in front of the Academy still in production refuses every registration
 * that omits a name, which is all of them; a corrected Academy in front of the
 * old Backend promises any six-character password to a schema that still demands
 * three character categories. Neither is a deployment, both are an outage.
 *
 * So this build is deliberately asymmetric: the NEW password policy and the new
 * change-password route, with the OLD name rule restored verbatim. It is safe
 * under the Academy that is live today AND under the corrected one.
 *
 * The tests below assert both halves of that, and they assert that the state is
 * marked as temporary. The final build deletes this file and adds the one that
 * asserts the opposite.
 */

describe("this build is a deployment bridge, and says so", () => {
  it("marks itself", () => {
    expect(REGISTRATION_NAME_BRIDGE).toBe(true);
  });

  it("says why, where the rule is", () => {
    const source = readFileSync("src/lib/validation.ts", "utf8");
    expect(source).toContain("DEPLOYMENT BRIDGE");
    expect(source).toContain("REGISTRATION_NAME_BRIDGE");
    /* The route's fallback must be marked too, or it reads as the intent. */
    expect(readFileSync("src/app/api/auth/register/route.ts", "utf8")).toContain("BRIDGE ONLY");
  });
});

describe("the OLD name rule, restored verbatim for the Academy in production", () => {
  const parse = (input: Record<string, unknown>) =>
    registerSchema.safeParse({ email: "a@b.invalid", password: "abcdef", ...input });

  it("accepts a registration with no name, which is what the live Academy sends", () => {
    expect(parse({}).success).toBe(true);
  });

  it("accepts one character, because the live client never checked", () => {
    expect(parse({ name: "Я" }).success).toBe(true);
  });

  it("still refuses a name that is only whitespace", () => {
    /* `.trim().min(1)` — the pre-phase rule exactly, not a weaker one. */
    expect(parse({ name: "   " }).success).toBe(false);
  });

  it("still keeps something to write, because the column is NOT NULL", () => {
    expect(readFileSync("src/app/api/auth/register/route.ts", "utf8")).toContain("Трейдер-${");
  });
});

describe("the NEW halves are already here, which is the point of the bridge", () => {
  const parse = (password: string) =>
    registerSchema.safeParse({ email: "a@b.invalid", password });

  it("asks nothing of a password but its length", () => {
    for (const password of ["abcdef", "123456", "пароль", "      "]) {
      expect(parse(password).success, password).toBe(true);
    }
    expect(parse("abcde").success).toBe(false);
  });

  it("carries the change-password route", () => {
    const route = readFileSync("src/app/api/auth/change-password/route.ts", "utf8");
    expect(route).toContain("issueSessionWithin");
    expect(route).toContain("INVALID_CURRENT_PASSWORD");
  });
});
