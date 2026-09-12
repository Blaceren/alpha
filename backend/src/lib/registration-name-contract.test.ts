import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as validation from "@/lib/validation";
import { registerSchema } from "@/lib/validation";

/**
 * THE NAME CONTRACT THIS BUILD CARRIES — and it is the end of the sequence.
 *
 * The build before this one was a deployment bridge: the new password policy and
 * the new change-password route, with the old name rule restored so that the
 * Academy still in production could not be broken by shipping order. Once the
 * corrected Academy is live, the bridge has no one left to protect.
 *
 * This build removes it. `name` is required and bounded, the generated
 * Трейдер-#### is gone, and the marker that made the temporary state visible is
 * gone with the behaviour it marked — asserted below, because a bridge that
 * outlives its purpose is indistinguishable from a decision nobody made.
 */

describe("the bridge is gone, and its absence is checked", () => {
  it("exports no bridge marker", () => {
    expect("REGISTRATION_NAME_BRIDGE" in validation).toBe(false);
  });

  it("leaves no bridge language behind in the source", () => {
    const schema = readFileSync("src/lib/validation.ts", "utf8");
    const route = readFileSync("src/app/api/auth/register/route.ts", "utf8");
    expect(schema).not.toContain("DEPLOYMENT BRIDGE");
    expect(schema).not.toContain("REGISTRATION_NAME_BRIDGE");
    expect(route).not.toContain("BRIDGE ONLY");
  });

  it("generates no name, anywhere", () => {
    const route = readFileSync("src/app/api/auth/register/route.ts", "utf8");
    expect(route).not.toContain("Трейдер-${");
    expect(route).toContain("name: parsed.data.name,");
  });
});

describe("a new registration must carry a name", () => {
  const parse = (input: Record<string, unknown>) =>
    registerSchema.safeParse({ email: "a@b.invalid", password: "abcdef", ...input });

  it("refuses a registration with no name at all", () => {
    expect(parse({}).success).toBe(false);
  });

  it("refuses a name that is only whitespace", () => {
    expect(parse({ name: "   " }).success).toBe(false);
  });

  it("refuses one character after trimming", () => {
    expect(parse({ name: " Я " }).success).toBe(false);
  });

  it("accepts the two ends of the range", () => {
    expect(parse({ name: "Ян" }).success).toBe(true);
    expect(parse({ name: "и".repeat(50) }).success).toBe(true);
  });

  it("refuses fifty-one", () => {
    expect(parse({ name: "и".repeat(51) }).success).toBe(false);
  });

  it("stores the trimmed name, so whitespace cannot buy length", () => {
    const parsed = parse({ name: "  Анна  " });
    expect(parsed.success && parsed.data.name).toBe("Анна");
  });
});

describe("everything the bridge already carried is still here", () => {
  it("asks nothing of a password but its length", () => {
    for (const password of ["abcdef", "123456", "пароль", "      "]) {
      expect(
        registerSchema.safeParse({ email: "a@b.invalid", name: "Имя", password }).success,
        password,
      ).toBe(true);
    }
    expect(
      registerSchema.safeParse({ email: "a@b.invalid", name: "Имя", password: "abcde" }).success,
    ).toBe(false);
  });

  it("carries the change-password route unchanged", () => {
    const route = readFileSync("src/app/api/auth/change-password/route.ts", "utf8");
    expect(route).toContain("issueSessionWithin");
    expect(route).toContain("INVALID_CURRENT_PASSWORD");
  });
});
