/**
 * A SIGNED-IN LEARNER HAS NOTHING TO DO AT THE DOOR (2026-10-04, launch audit).
 * Signing in again replaced the session; from /register a second account could
 * be made over the first. They go where they were heading — and only a
 * confirmed viewer is sent on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/config/academy-config", () => ({
  getAcademyConfig: () => ({ mode: "api", turnstileSiteKey: null, backendOrigin: "https://b.invalid", requestTimeoutMs: 1000 }),
}));
const readServerSession = vi.fn();
vi.mock("@/server/auth/server-session", () => ({ readServerSession: () => readServerSession() }));
vi.mock("@/server/auth/account-read", () => ({
  readAccountCapabilities: vi.fn(async () => ({ passwordRecovery: false, emailVerification: false, emailChange: false })),
  readRegistrationOpensLearning: vi.fn(async () => true),
}));

import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";

const viewer = { kind: "viewer", viewer: { id: "1", name: "Анна", role: "user", status: "active", synthetic: false } };

beforeEach(() => readServerSession.mockReset());

describe("signed in at the door", () => {
  it("login sends the learner where they were heading, safely", async () => {
    readServerSession.mockResolvedValue(viewer);
    await expect(LoginPage({ searchParams: Promise.resolve({ next: "/tools/journal" }) })).rejects.toThrow("redirect:/tools/journal");
    await expect(LoginPage({ searchParams: Promise.resolve({ next: "//evil.example" }) })).rejects.toThrow("redirect:/home");
    await expect(LoginPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/home");
  });

  it("register sends the learner to Home", async () => {
    readServerSession.mockResolvedValue(viewer);
    await expect(RegisterPage()).rejects.toThrow("redirect:/home");
  });

  it("keeps the forms for a visitor, and for a Backend that cannot answer", async () => {
    for (const kind of ["signed-out", "unavailable"]) {
      readServerSession.mockResolvedValue({ kind });
      await expect(LoginPage({ searchParams: Promise.resolve({ next: "/tools" }) })).resolves.toBeTruthy();
      await expect(RegisterPage()).resolves.toBeTruthy();
    }
  });
});
