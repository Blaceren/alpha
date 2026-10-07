import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { isUniqueViolationOn } from "@/lib/unique-violation";

const known = (meta: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`email`)", {
    code: "P2002",
    clientVersion: "test",
    meta,
  });

describe("isUniqueViolationOn", () => {
  it("recognises the shape Prisma gives a second account on one address", () => {
    // Observed 2026-10-07 on this schema: meta {"modelName":"User","target":["email"]}.
    expect(isUniqueViolationOn(known({ modelName: "User", target: ["email"] }), "User", "email")).toBe(true);
    expect(isUniqueViolationOn(known({ modelName: "User", target: "User_email_key" }), "User", "email")).toBe(true);
    expect(isUniqueViolationOn(new Error("UNIQUE constraint failed: User.email"), "User", "email")).toBe(true);
  });

  it("is not fooled by another table's email or another field", () => {
    expect(isUniqueViolationOn(known({ modelName: "Lead", target: ["email"] }), "User", "email")).toBe(false);
    expect(isUniqueViolationOn(known({ modelName: "User", target: ["referralCode"] }), "User", "email")).toBe(false);
    expect(isUniqueViolationOn(new Error("UNIQUE constraint failed: User.emailVerifiedAt"), "User", "email")).toBe(false);
    expect(isUniqueViolationOn(new Error("something else"), "User", "email")).toBe(false);
    expect(isUniqueViolationOn(null, "User", "email")).toBe(false);
  });
});
