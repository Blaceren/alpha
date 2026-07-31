import { describe, it, expect } from "vitest";
import {
  CAPTCHA_TOKEN_FIELD,
  canSubmitRegistration,
  hasCaptchaWidget,
  resolveCaptchaContract,
} from "@/lib/auth/captcha-contract";
import {
  TURNSTILE_ORIGIN,
  TURNSTILE_REGISTER_ACTION,
  TURNSTILE_SCRIPT_URL,
  isValidTurnstileSiteKey,
} from "@/lib/auth/turnstile";
import { TEST_SITE_KEY } from "@/test/turnstile-double";

describe("CAPTCHA contract", () => {
  it("uses the exact optional field name from the Backend DTO", () => {
    expect(CAPTCHA_TOKEN_FIELD).toBe("captchaToken");
  });

  it("resolves a Turnstile provider from a runtime site key", () => {
    expect(resolveCaptchaContract(TEST_SITE_KEY)).toEqual({
      mode: "provider",
      provider: "turnstile",
      siteKey: TEST_SITE_KEY,
    });
  });

  it("trims surrounding whitespace from an env-supplied key", () => {
    expect(resolveCaptchaContract(`  ${TEST_SITE_KEY}  `)).toEqual({
      mode: "provider",
      provider: "turnstile",
      siteKey: TEST_SITE_KEY,
    });
  });

  it.each([
    ["absent", null],
    ["undefined", undefined],
    ["empty", ""],
    ["whitespace", "   "],
  ])("reports %s site key as unavailable, never as a pass", (_label, value) => {
    expect(resolveCaptchaContract(value)).toEqual({
      mode: "unavailable",
      reason: "site_key_absent",
    });
  });

  it.each([
    ["a quoted value", '"0x4AAAAAAABBBBCCCC"'],
    ["a URL", "https://example.com/key"],
    ["a bare word", "sitekey"],
    ["too short", "0xABC"],
  ])("reports %s as malformed rather than usable", (_label, value) => {
    expect(resolveCaptchaContract(value)).toEqual({
      mode: "unavailable",
      reason: "site_key_malformed",
    });
  });

  it("renders a widget only when a provider resolved", () => {
    expect(hasCaptchaWidget(resolveCaptchaContract(TEST_SITE_KEY))).toBe(true);
    expect(hasCaptchaWidget(resolveCaptchaContract(null))).toBe(false);
  });

  it("blocks submission until a provider AND a token both exist", () => {
    const provider = resolveCaptchaContract(TEST_SITE_KEY);
    const unavailable = resolveCaptchaContract(null);

    expect(canSubmitRegistration(provider, "token")).toBe(true);
    expect(canSubmitRegistration(provider, null)).toBe(false);
    expect(canSubmitRegistration(provider, "")).toBe(false);
    // The decisive case: no provider must NOT be treated as "nothing to check".
    expect(canSubmitRegistration(unavailable, "token")).toBe(false);
    expect(canSubmitRegistration(unavailable, null)).toBe(false);
  });

  it("does not embed the removed Backend dev bypass sentinel anywhere", async () => {
    // Shipping "dev-captcha-ok" in a PUBLIC bundle would be a fabricated
    // client-generated success token. The Backend's legacy pages still do this;
    // the Academy never has and never must.
    const contract = await import("@/lib/auth/captcha-contract");
    const turnstile = await import("@/lib/auth/turnstile");
    const serialized = JSON.stringify([Object.values(contract), Object.values(turnstile)]);
    expect(serialized).not.toContain("dev-captcha-ok");
  });

  it("hardcodes no site key in the module surface", () => {
    // The key must arrive at runtime. A literal here would pin every deployment
    // to one Cloudflare widget and make rotation a code change.
    const serialized = JSON.stringify([TURNSTILE_SCRIPT_URL, TURNSTILE_REGISTER_ACTION]);
    expect(serialized).not.toMatch(/[0-9]x[A-Za-z0-9_-]{10,}/);
  });
});

describe("Turnstile provider constants", () => {
  it("uses the official explicit-rendering script from the official origin", () => {
    expect(TURNSTILE_SCRIPT_URL).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    );
    expect(TURNSTILE_SCRIPT_URL.startsWith(`${TURNSTILE_ORIGIN}/`)).toBe(true);
    expect(TURNSTILE_ORIGIN.startsWith("https://")).toBe(true);
  });

  it("uses an action within Cloudflare's documented limits", () => {
    // Max 32 characters, alphanumerics plus underscore and hyphen.
    expect(TURNSTILE_REGISTER_ACTION).toBe("academy_register");
    expect(TURNSTILE_REGISTER_ACTION.length).toBeLessThanOrEqual(32);
    expect(TURNSTILE_REGISTER_ACTION).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("accepts real-shaped and official test site keys, rejects junk", () => {
    expect(isValidTurnstileSiteKey("0x4AAAAAAABkMYinukE8nzYS")).toBe(true);
    expect(isValidTurnstileSiteKey(TEST_SITE_KEY)).toBe(true);
    expect(isValidTurnstileSiteKey("")).toBe(false);
    expect(isValidTurnstileSiteKey("not-a-key")).toBe(false);
    expect(isValidTurnstileSiteKey("0x")).toBe(false);
  });
});
