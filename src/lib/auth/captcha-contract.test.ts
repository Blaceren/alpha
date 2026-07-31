import { describe, it, expect } from "vitest";
import {
  CAPTCHA_TOKEN_FIELD,
  hasCaptchaWidget,
  resolveCaptchaContract,
} from "@/lib/auth/captcha-contract";

describe("CAPTCHA contract", () => {
  it("uses the exact optional field name from the Backend DTO", () => {
    expect(CAPTCHA_TOKEN_FIELD).toBe("captchaToken");
  });

  it("reports no provider, because the Backend exposes none", () => {
    // Backend `verifyCaptcha` hard-codes provider "dev" and has no verification
    // call. There is no site key to render a widget with.
    expect(resolveCaptchaContract()).toEqual({ mode: "absent" });
  });

  it("renders no widget while no provider exists", () => {
    expect(hasCaptchaWidget(resolveCaptchaContract())).toBe(false);
  });

  it("would render a widget once a real provider is configured", () => {
    expect(hasCaptchaWidget({ mode: "provider", provider: "turnstile", siteKey: "0xPUBLIC" })).toBe(true);
  });

  it("does not embed the Backend dev bypass sentinel anywhere", async () => {
    // Shipping "dev-captcha-ok" in a PUBLIC bundle would be a fabricated
    // client-generated success token. The Academy must never do this, even
    // though the Backend's own legacy page does.
    const source = await import("@/lib/auth/captcha-contract");
    expect(JSON.stringify(Object.values(source))).not.toContain("dev-captcha-ok");
  });
});
