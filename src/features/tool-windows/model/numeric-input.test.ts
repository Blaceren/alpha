import { describe, expect, it } from "vitest";
import {
  PAYOUT_LIMITS,
  PAYOUT_MESSAGE,
  PAYOUT_PLACEHOLDER,
  digitsOnly,
  isPayoutDeadEnd,
  moneyOnly,
  parsePayoutPercent,
} from "./numeric-input";

describe("a whole-number field", () => {
  it("keeps the digits of what was typed or pasted, and nothing else", () => {
    expect(digitsOnly("льдл", 2)).toBe("");
    expect(digitsOnly("8л5", 2)).toBe("85");
    expect(digitsOnly("85%", 2)).toBe("85");
    expect(digitsOnly(" 9 0 ", 2)).toBe("90");
    expect(digitsOnly("-85", 2)).toBe("85");
    expect(digitsOnly("8.5", 2)).toBe("85");
    expect(digitsOnly("1e2", 2)).toBe("12");
    // Not every digit-looking character is one of ours.
    expect(digitsOnly("٨٥", 2)).toBe("");
    expect(digitsOnly("８５", 2)).toBe("");
  });

  it("stops at its length", () => {
    expect(digitsOnly("12345", 2)).toBe("12");
    expect(digitsOnly("100", 2)).toBe("10");
    expect(digitsOnly("", 2)).toBe("");
  });
});

describe("payout", () => {
  it("is a whole percent from 20 to 99", () => {
    expect(PAYOUT_LIMITS).toEqual({ min: 20, max: 99 });
    expect(parsePayoutPercent("20")).toBe(20);
    expect(parsePayoutPercent("85")).toBe(85);
    expect(parsePayoutPercent("99")).toBe(99);
    expect(parsePayoutPercent(" 92 ")).toBe(92);
  });

  it("is nothing below 20, above 99, or not a whole number", () => {
    for (const raw of ["", "0", "1", "9", "19", "100", "101", "8.5", "85%", "8a", "-85", "+85", "1e2", "льдл"]) {
      expect(parsePayoutPercent(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it("is a dead end when no further key can make it a payout", () => {
    // Two digits are all the field takes: outside the range, they stay outside.
    for (const raw of ["00", "05", "10", "15", "19"]) expect(isPayoutDeadEnd(raw), raw).toBe(true);
    // No payout begins with «0» or «1».
    for (const raw of ["0", "1"]) expect(isPayoutDeadEnd(raw), raw).toBe(true);
    // «2»…«9» are on the way to «20»…«99»: not a payout yet, and not a mistake.
    for (const raw of ["2", "5", "9"]) expect(isPayoutDeadEnd(raw), raw).toBe(false);
    // A payout, and an empty field, are not dead ends.
    for (const raw of ["", "20", "85", "99"]) expect(isPayoutDeadEnd(raw), raw).toBe(false);
  });

  it("says its range in the message and in the empty field", () => {
    expect(PAYOUT_MESSAGE).toBe("Payout — целое число от 20 до 99.");
    expect(PAYOUT_PLACEHOLDER).toBe("20–99");
  });
});

describe("a money field", () => {
  it("keeps digits and one decimal mark, as the learner typed it", () => {
    expect(moneyOnly("12.5")).toBe("12.5");
    expect(moneyOnly("12,5")).toBe("12,5");
    expect(moneyOnly("льдл")).toBe("");
    expect(moneyOnly("1 000,50")).toBe("1000,50");
    expect(moneyOnly("$8.00")).toBe("8.00");
    expect(moneyOnly("8.")).toBe("8.");
    expect(moneyOnly("-8")).toBe("8");
    expect(moneyOnly("1e3")).toBe("13");
  });

  it("takes one mark, two digits after it and seven before", () => {
    expect(moneyOnly("1.2.3")).toBe("1.23");
    expect(moneyOnly("1,2.3")).toBe("1,23");
    expect(moneyOnly("8.999")).toBe("8.99");
    expect(moneyOnly("123456789")).toBe("1234567");
    expect(moneyOnly("12345678.9")).toBe("1234567.9");
  });

  it("drops a mark that has nothing before it", () => {
    expect(moneyOnly(".5")).toBe("5");
    expect(moneyOnly(",")).toBe("");
  });
});
