import { describe, it, expect } from "vitest";
import {
  MAX_REFERRAL_CODE_LENGTH,
  readReferralCode,
  sanitizeReferralCode,
} from "@/lib/auth/referral-code";

describe("sanitizeReferralCode", () => {
  it("accepts a Backend-minted cuid", () => {
    expect(sanitizeReferralCode("clh3k2j9x0000qw8b1a2c3d4e")).toEqual({
      status: "valid",
      code: "clh3k2j9x0000qw8b1a2c3d4e",
    });
  });

  it("accepts an operator-assigned code with - and _", () => {
    expect(sanitizeReferralCode("L2START_mentor-1")).toEqual({
      status: "valid",
      code: "L2START_mentor-1",
    });
  });

  it("trims surrounding whitespace, agreeing with Backend's .trim()", () => {
    expect(sanitizeReferralCode("  ABC123  ")).toEqual({ status: "valid", code: "ABC123" });
  });

  it("treats absent and blank as no referral", () => {
    expect(sanitizeReferralCode(null).status).toBe("absent");
    expect(sanitizeReferralCode(undefined).status).toBe("absent");
    expect(sanitizeReferralCode("").status).toBe("absent");
    expect(sanitizeReferralCode("   ").status).toBe("absent");
  });

  it("accepts exactly Backend's maximum length and rejects one over", () => {
    expect(sanitizeReferralCode("a".repeat(MAX_REFERRAL_CODE_LENGTH)).status).toBe("valid");
    expect(sanitizeReferralCode("a".repeat(MAX_REFERRAL_CODE_LENGTH + 1)).status).toBe("malformed");
  });

  it("rejects values outside the code alphabet without forwarding them", () => {
    for (const value of [
      "abc def",
      "abc/def",
      "<script>alert(1)</script>",
      "abc\u0000def",  // NUL
      "код",
      "a.b",
      "abc%20def",
      "../../etc/passwd",
      "https://evil.example.com",
    ]) {
      const result = sanitizeReferralCode(value);
      expect(result.status, value).toBe("malformed");
      expect(result.code).toBeNull();
    }
  });
});

describe("readReferralCode", () => {
  it("reads ?ref= from the query", () => {
    expect(readReferralCode(new URLSearchParams("ref=ABC123"))).toEqual({
      status: "valid",
      code: "ABC123",
    });
  });

  it("uses the FIRST value when ref is repeated", () => {
    expect(readReferralCode(new URLSearchParams("ref=FIRST&ref=SECOND"))).toEqual({
      status: "valid",
      code: "FIRST",
    });
  });

  it("is absent when the query has no ref", () => {
    expect(readReferralCode(new URLSearchParams("next=/path")).status).toBe("absent");
    expect(readReferralCode(null).status).toBe("absent");
  });

  it("does not interpret an affiliate or Pocket identifier as a referral", () => {
    // These are AFD-3B / Pocket concepts. `ref` is an ATA User.referralCode and
    // nothing else; none of these parameters is read here.
    const params = new URLSearchParams("click_id=abc&clickid=abc&playerid=1&ataClickId=x");
    expect(readReferralCode(params).status).toBe("absent");
  });
});
