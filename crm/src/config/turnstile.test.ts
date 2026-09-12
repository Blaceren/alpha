import { describe, expect, it } from "vitest";
import { TURNSTILE_SITE_KEY_ENV, resolveTurnstileSiteKey } from "@/config/turnstile";
import { isValidTurnstileSiteKey, resolveCaptchaContract } from "@/lib/auth/turnstile";

describe("CRM Turnstile site-key delivery (AFD-3A3)", () => {
  it("reads the runtime key, and is not a NEXT_PUBLIC build-time inline", () => {
    expect(TURNSTILE_SITE_KEY_ENV).toBe("TURNSTILE_SITE_KEY");
    // A NEXT_PUBLIC_ name would be baked into the bundle at build time, pinning
    // one build to one Cloudflare widget and turning rotation into a release.
    expect(TURNSTILE_SITE_KEY_ENV.startsWith("NEXT_PUBLIC_")).toBe(false);
    expect(resolveTurnstileSiteKey({ TURNSTILE_SITE_KEY: "1x00000000000000000000AA" })).toBe(
      "1x00000000000000000000AA",
    );
  });

  it("treats absent, empty and whitespace-only as absent", () => {
    expect(resolveTurnstileSiteKey({})).toBeNull();
    expect(resolveTurnstileSiteKey({ TURNSTILE_SITE_KEY: "" })).toBeNull();
    expect(resolveTurnstileSiteKey({ TURNSTILE_SITE_KEY: "   " })).toBeNull();
  });

  it("reads no secret of any kind", () => {
    // The SECRET is a backend credential. If it were ever present in this
    // package's environment, nothing here would pick it up.
    const source = {
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "must-never-be-read",
      SESSION_SECRET: "must-never-be-read",
      POSTBACK_SECRET: "must-never-be-read",
    };
    expect(resolveTurnstileSiteKey(source)).toBe("1x00000000000000000000AA");
  });
});

describe("CRM Turnstile contract", () => {
  it("an absent key is unavailable, never a pass", () => {
    expect(resolveCaptchaContract(null)).toEqual({
      mode: "unavailable",
      reason: "site_key_absent",
    });
    expect(resolveCaptchaContract(undefined).mode).toBe("unavailable");
    expect(resolveCaptchaContract("  ").mode).toBe("unavailable");
  });

  it("a malformed key is reported distinctly from an absent one", () => {
    // So an operator who pasted a secret, a URL or a quoted value gets a
    // diagnostic that says which mistake they made.
    for (const bad of ["not-a-key", "https://example.com", '"1x0000"', "0x", ""]) {
      const contract = resolveCaptchaContract(bad);
      expect(contract.mode).toBe("unavailable");
    }
    expect(resolveCaptchaContract("not-a-key")).toEqual({
      mode: "unavailable",
      reason: "site_key_malformed",
    });
  });

  it("accepts a real-shaped key and Cloudflare's published test keys", () => {
    for (const key of ["0x4AAAAAAABkMYinukE8nzYS", "1x00000000000000000000AA", "2x00000000000000000000AB"]) {
      expect(isValidTurnstileSiteKey(key)).toBe(true);
      expect(resolveCaptchaContract(key)).toEqual({ mode: "provider", siteKey: key });
    }
  });

  it("hardcodes no site key in source", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await readFile(path.resolve(__dirname, "../lib/auth/turnstile.ts"), "utf8");
    // The shape pattern is present; an actual key is not. A key in source pins
    // every deployment to one widget.
    expect(/sitekey\s*[:=]\s*["'][0-9]x/.test(source)).toBe(false);
    expect(source).not.toContain("0x4AAAAAAA");
  });
});
