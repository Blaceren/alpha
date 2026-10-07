import { describe, expect, it } from "vitest";
import { loginSchema, newPasswordSchema, passwordSchema, registerSchema } from "@/lib/validation";

/* 2026-10-07 audit: bcrypt hashes only the first 72 bytes; an address is at most 254 characters. */
describe("a password being set", () => {
  it("is refused past 72 bytes, counting a Cyrillic letter as two", () => {
    expect(newPasswordSchema.safeParse("a".repeat(72)).success).toBe(true);
    expect(newPasswordSchema.safeParse("a".repeat(73)).success).toBe(false);
    expect(newPasswordSchema.safeParse("я".repeat(36)).success).toBe(true);
    expect(newPasswordSchema.safeParse("я".repeat(37)).success).toBe(false);
    expect(newPasswordSchema.safeParse("короткий").success).toBe(true);
  });

  it("applies at registration, not at sign-in — an older long password still signs in", () => {
    const long = "длинная-фраза-".repeat(6);
    expect(registerSchema.safeParse({ email: "a@example.test", password: long, name: "Имя" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@example.test", password: long }).success).toBe(true);
    expect(passwordSchema.safeParse(long).success).toBe(true);
  });
});

describe("an email", () => {
  it("longer than 254 characters is refused before anything is counted or recorded", () => {
    const long = `${"a".repeat(250)}@example.test`;
    expect(loginSchema.safeParse({ email: long, password: "secret1" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "learner@example.test", password: "secret1" }).success).toBe(true);
  });
});
