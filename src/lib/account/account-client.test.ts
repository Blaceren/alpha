import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelEmailChange,
  confirmEmailChange,
  confirmPasswordReset,
  requestEmailChange,
  requestPasswordReset,
  resendVerification,
  verifyEmail,
} from "./account-client";
import { NO_ACCOUNT_CAPABILITIES, isAccountCapabilities, isAccountView } from "./account-types";

/**
 * ACCOUNT RECOVERY — the browser's calls. What is pinned here is the wire: the
 * path, the body (exactly the fields the Backend's closed schemas accept), the
 * CSRF header on the authenticated mutations and its absence on the anonymous
 * ones, and the closed set of outcomes each answer becomes.
 */

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
const calls: Call[] = [];
let answers: Array<{ status: number; body?: unknown } | "network">;

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { "content-type": "application/json" },
  });
}

beforeEach(() => {
  calls.length = 0;
  answers = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ url, method: init.method ?? "GET", headers, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    if (url.endsWith("/csrf")) return json(200, { csrfToken: "csrf-value" });
    const next = answers.shift() ?? { status: 200, body: { ok: true } };
    if (next === "network") throw new TypeError("network");
    return json(next.status, next.body);
  }));
});
afterEach(() => vi.unstubAllGlobals());

const last = () => calls[calls.length - 1]!;

describe("asking for a reset link", () => {
  it("posts the address and the challenge token, with no CSRF round trip", async () => {
    expect(await requestPasswordReset({ email: "a@example.invalid", captchaToken: "t" })).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect([last().url, last().method, last().body]).toEqual(["/api/backend/auth/password-reset/request", "POST", { email: "a@example.invalid", captchaToken: "t" }]);
    expect(last().headers["x-csrf-token"]).toBeUndefined();
  });

  it("never serialises an absent token", async () => {
    await requestPasswordReset({ email: "a@example.invalid" });
    expect(last().body).toEqual({ email: "a@example.invalid" });
  });

  it("names each refusal", async () => {
    const cases: Array<[{ status: number; body?: unknown } | "network", string]> = [
      [{ status: 400, body: { error: "CAPTCHA_FAILED" } }, "CAPTCHA_FAILED"],
      [{ status: 503, body: { error: "CAPTCHA_UNAVAILABLE" } }, "CAPTCHA_UNAVAILABLE"],
      [{ status: 503, body: { error: "CAPTCHA_CONFIGURATION_ERROR" } }, "CAPTCHA_CONFIGURATION_ERROR"],
      [{ status: 503, body: { error: "RECOVERY_UNAVAILABLE" } }, "UNAVAILABLE"],
      [{ status: 429, body: { error: "RATE_LIMITED" } }, "RATE_LIMITED"],
      [{ status: 400, body: { error: "VALIDATION_ERROR" } }, "VALIDATION_ERROR"],
      [{ status: 500 }, "FAILED"],
      ["network", "FAILED"],
    ];
    for (const [answer, failure] of cases) {
      answers = [answer];
      const result = await requestPasswordReset({ email: "a@example.invalid", captchaToken: "t" });
      expect(result.ok === false && result.failure, JSON.stringify(answer)).toBe(failure);
    }
  });
});

describe("setting the new password", () => {
  it("posts the token and the password in the body", async () => {
    expect(await confirmPasswordReset({ token: "T".repeat(43), newPassword: "New-password-2" })).toEqual({ ok: true });
    expect([last().url, last().body]).toEqual(["/api/backend/auth/password-reset/confirm", { token: "T".repeat(43), newPassword: "New-password-2" }]);
    expect(last().url).not.toContain("T".repeat(43));
  });

  it("tells a dead link from a short password from an outage", async () => {
    answers = [{ status: 400, body: { error: "INVALID_TOKEN" } }, { status: 400, body: { error: "VALIDATION_ERROR" } }, { status: 429 }, { status: 502 }];
    const failures = [];
    for (let i = 0; i < 4; i += 1) {
      const result = await confirmPasswordReset({ token: "t", newPassword: "p" });
      failures.push(result.ok ? "ok" : result.failure);
    }
    expect(failures).toEqual(["INVALID_TOKEN", "VALIDATION_ERROR", "RATE_LIMITED", "FAILED"]);
  });
});

describe("confirming an address with a link", () => {
  it("uses one route for the account's address and another for a new one", async () => {
    await verifyEmail("v-token-0123456789");
    expect([last().url, last().body]).toEqual(["/api/backend/auth/verify-email", { token: "v-token-0123456789" }]);
    await confirmEmailChange("c-token-0123456789");
    expect([last().url, last().body]).toEqual(["/api/backend/auth/email-change/confirm", { token: "c-token-0123456789" }]);
  });

  it("names a dead link and a taken address", async () => {
    answers = [{ status: 400, body: { error: "INVALID_TOKEN" } }, { status: 409, body: { error: "EMAIL_IN_USE" } }, "network"];
    expect(await verifyEmail("x")).toEqual({ ok: false, failure: "INVALID_TOKEN" });
    expect(await confirmEmailChange("x")).toEqual({ ok: false, failure: "EMAIL_IN_USE" });
    expect(await confirmEmailChange("x")).toEqual({ ok: false, failure: "FAILED" });
  });
});

describe("the signed-in actions carry the CSRF token", () => {
  it("resend: fetches a token, posts no body, and reads what was actually sent", async () => {
    answers = [{ status: 200, body: { ok: true, sent: true } }];
    expect(await resendVerification()).toEqual({ ok: true, alreadyVerified: false });
    expect(calls.map((c) => c.url)).toEqual(["/api/backend/csrf", "/api/backend/auth/resend-verification"]);
    expect(last().headers["x-csrf-token"]).toBe("csrf-value");
    expect(last().body).toBeUndefined();

    answers = [{ status: 200, body: { ok: true, alreadyVerified: true } }];
    expect(await resendVerification()).toEqual({ ok: true, alreadyVerified: true });
    // A 200 that did not send is not a success the page may announce.
    answers = [{ status: 200, body: { ok: true, sent: false } }];
    expect(await resendVerification()).toEqual({ ok: false, failure: "FAILED" });
    answers = [{ status: 503, body: { error: "VERIFICATION_UNAVAILABLE" } }];
    expect(await resendVerification()).toEqual({ ok: false, failure: "UNAVAILABLE" });
    answers = [{ status: 429 }];
    expect(await resendVerification()).toEqual({ ok: false, failure: "RATE_LIMITED" });
  });

  it("change: posts the new address and the current password, and returns the pending address the server recorded", async () => {
    answers = [{ status: 200, body: { ok: true, pendingEmail: "new@example.invalid" } }];
    expect(await requestEmailChange({ newEmail: "new@example.invalid", currentPassword: "Password-1" })).toEqual({ ok: true, pendingEmail: "new@example.invalid" });
    expect([last().url, last().body, last().headers["x-csrf-token"]]).toEqual(["/api/backend/profile/email-change", { newEmail: "new@example.invalid", currentPassword: "Password-1" }, "csrf-value"]);
  });

  it("change: names every refusal", async () => {
    const cases: Array<[{ status: number; body?: unknown }, string]> = [
      [{ status: 400, body: { error: "INVALID_PASSWORD" } }, "INVALID_PASSWORD"],
      [{ status: 400, body: { error: "SAME_EMAIL" } }, "SAME_EMAIL"],
      [{ status: 409, body: { error: "EMAIL_IN_USE" } }, "EMAIL_IN_USE"],
      [{ status: 503, body: { error: "MAIL_UNAVAILABLE" } }, "UNAVAILABLE"],
      [{ status: 429 }, "RATE_LIMITED"],
      [{ status: 400, body: { error: "VALIDATION_ERROR" } }, "VALIDATION_ERROR"],
      [{ status: 200, body: { ok: true } }, "FAILED"],
      [{ status: 500 }, "FAILED"],
    ];
    for (const [answer, failure] of cases) {
      answers = [answer];
      const result = await requestEmailChange({ newEmail: "n@example.invalid", currentPassword: "p" });
      expect(result.ok === false && result.failure, JSON.stringify(answer)).toBe(failure);
    }
  });

  it("cancel: posts to the cancel route with the token", async () => {
    expect(await cancelEmailChange()).toEqual({ ok: true });
    expect([last().url, last().method, last().headers["x-csrf-token"]]).toEqual(["/api/backend/profile/email-change/cancel", "POST", "csrf-value"]);
    answers = [{ status: 401 }];
    expect(await cancelEmailChange()).toEqual({ ok: false });
  });

  it("sends nothing when the CSRF token cannot be had", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(500)));
    expect(await resendVerification()).toEqual({ ok: false, failure: "FAILED" });
    expect(await requestEmailChange({ newEmail: "n@example.invalid", currentPassword: "p" })).toEqual({ ok: false, failure: "FAILED" });
    expect(await cancelEmailChange()).toEqual({ ok: false });
  });
});

describe("the shapes read from the Backend", () => {
  it("accept exactly what the Backend sends and nothing looser", () => {
    const capabilities = { passwordRecovery: true, emailVerification: true, emailChange: false };
    expect(isAccountCapabilities(capabilities)).toBe(true);
    expect(isAccountCapabilities({ passwordRecovery: "yes", emailVerification: true, emailChange: true })).toBe(false);
    expect(isAccountCapabilities(null)).toBe(false);
    expect(isAccountView({ account: { email: "a@example.invalid", emailVerified: false, pendingEmail: null }, capabilities })).toBe(true);
    expect(isAccountView({ account: { email: "", emailVerified: false, pendingEmail: null }, capabilities })).toBe(false);
    expect(isAccountView({ account: { email: "a@example.invalid", emailVerified: false }, capabilities })).toBe(false);
    expect(isAccountView({ account: { email: "a@example.invalid", emailVerified: false, pendingEmail: null } })).toBe(false);
    expect(Object.values(NO_ACCOUNT_CAPABILITIES)).toEqual([false, false, false]);
  });
});
