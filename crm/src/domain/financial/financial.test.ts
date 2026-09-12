import { describe, expect, it } from "vitest";
import { FINANCIAL_BUCKET_LABEL, toFinancialBucket } from "./financial";

describe("financial buckets (DECISIONS D-07)", () => {
  it("maps amounts to the correct bucket boundaries", () => {
    expect(toFinancialBucket(0)).toBe("below_50");
    expect(toFinancialBucket(4999)).toBe("below_50"); // $49.99
    expect(toFinancialBucket(5000)).toBe("50_99"); // $50.00
    expect(toFinancialBucket(10000)).toBe("100_199"); // $100
    expect(toFinancialBucket(50000)).toBe("500_999"); // $500
    expect(toFinancialBucket(100000)).toBe("1000_2499"); // $1000
    expect(toFinancialBucket(1000000)).toBe("10000_plus"); // $10000
  });

  it("has a human label for every bucket", () => {
    for (const bucket of Object.keys(FINANCIAL_BUCKET_LABEL)) {
      expect(FINANCIAL_BUCKET_LABEL[bucket as keyof typeof FINANCIAL_BUCKET_LABEL]).toBeTruthy();
    }
  });
});
