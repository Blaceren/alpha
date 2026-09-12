import { describe, expect, it } from "vitest";
import { shouldUseSecureCookies } from "./cookie-security";

describe("shouldUseSecureCookies", () => {
  it("is true for an https CRM_APP_URL", () => {
    expect(shouldUseSecureCookies({ CRM_APP_URL: "https://crm.example.com" })).toBe(true);
  });

  it("is false for an http CRM_APP_URL even in a production build", () => {
    // The explicit deployment answer wins: an operator who says the CRM is
    // served over http must not get cookies the browser will refuse to send.
    expect(
      shouldUseSecureCookies({ CRM_APP_URL: "http://127.0.0.1:3010", NODE_ENV: "production" }),
    ).toBe(false);
  });

  it("falls back to NODE_ENV=production when CRM_APP_URL is absent", () => {
    expect(shouldUseSecureCookies({ NODE_ENV: "production" })).toBe(true);
    expect(shouldUseSecureCookies({ NODE_ENV: "development" })).toBe(false);
    expect(shouldUseSecureCookies({})).toBe(false);
  });

  it("does NOT downgrade production when CRM_APP_URL is malformed", () => {
    // A typo must fail toward Secure, never away from it.
    for (const malformed of ["not-a-url", "://", "https//missing-colon", " "]) {
      expect(
        shouldUseSecureCookies({ CRM_APP_URL: malformed, NODE_ENV: "production" }),
        `malformed value ${JSON.stringify(malformed)} downgraded production`,
      ).toBe(true);
    }
  });

  it("treats an empty CRM_APP_URL as absent", () => {
    expect(shouldUseSecureCookies({ CRM_APP_URL: "", NODE_ENV: "production" })).toBe(true);
    expect(shouldUseSecureCookies({ CRM_APP_URL: "   ", NODE_ENV: "development" })).toBe(false);
  });
});
