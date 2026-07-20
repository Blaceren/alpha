import { describe, expect, it } from "vitest";
import {
  calculateRisk,
  MAX_INPUT_LENGTH,
  parseDecimal,
  type RiskInput,
} from "@/features/tools/model/risk-calculation";
import { formatNumber, formatPercent, PRECISION } from "@/features/tools/model/risk-format";

const base: RiskInput = { capital: "1000", riskPercent: "2", entryPrice: "100", stopPrice: "96" };

function calc(patch: Partial<RiskInput> = {}) {
  return calculateRisk({ ...base, ...patch });
}

describe("parseDecimal — controlled string syntax", () => {
  it("accepts an integer", () => {
    expect(parseDecimal("1000")).toEqual({ ok: true, value: 1000 });
  });
  it("accepts a period decimal", () => {
    expect(parseDecimal("1000.5")).toEqual({ ok: true, value: 1000.5 });
  });
  it("accepts a comma decimal", () => {
    expect(parseDecimal("1000,5")).toEqual({ ok: true, value: 1000.5 });
  });
  it("accepts a leading-zero fraction with each separator", () => {
    expect(parseDecimal("0.25")).toEqual({ ok: true, value: 0.25 });
    expect(parseDecimal("0,25")).toEqual({ ok: true, value: 0.25 });
  });
  it("trims surrounding whitespace", () => {
    expect(parseDecimal("  12,5  ")).toEqual({ ok: true, value: 12.5 });
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["plus sign", "+5"],
    ["negative sign", "-5"],
    ["exponent", "1e5"],
    ["uppercase exponent", "1E5"],
    ["internal whitespace", "1 000"],
    ["thousands separator", "1,000.5"],
    ["mixed comma then period", "1,0.5"],
    ["mixed period then comma", "1.0,5"],
    ["two periods", "1.0.5"],
    ["two commas", "1,0,5"],
    ["bare period", "."],
    ["bare comma", ","],
    ["trailing separator", "1."],
    ["leading separator", ".5"],
    ["hex", "0x10"],
    ["NaN literal", "NaN"],
    ["Infinity literal", "Infinity"],
    ["letters", "abc"],
  ])("rejects %s", (_label, raw) => {
    expect(parseDecimal(raw)).toEqual({ ok: false });
  });

  it("rejects input longer than the safe bound", () => {
    expect(parseDecimal("1".repeat(MAX_INPUT_LENGTH + 1))).toEqual({ ok: false });
  });
});

describe("calculateRisk — states", () => {
  it("empty input is incomplete, never valid", () => {
    const r = calculateRisk({ capital: "", riskPercent: "", entryPrice: "", stopPrice: "" });
    expect(r.status).toBe("incomplete");
  });

  it("a partially filled form is incomplete, never a fake result", () => {
    const r = calc({ stopPrice: "" });
    expect(r.status).toBe("incomplete");
    if (r.status === "incomplete") expect(r.fields.stopPrice).toBe("empty");
  });

  it("a malformed filled field is invalid with a format error", () => {
    const r = calc({ entryPrice: "1,0.5" });
    expect(r.status).toBe("invalid");
    if (r.status === "invalid") expect(r.fields.entryPrice).toBe("format");
  });
});

describe("calculateRisk — valid long", () => {
  const r = calc();
  it("is valid and long (stop below entry)", () => {
    expect(r.status).toBe("valid");
    if (r.status === "valid") expect(r.direction).toBe("long");
  });
  it("computes exact figures for the canonical example", () => {
    if (r.status !== "valid") throw new Error("expected valid");
    expect(r.riskAmount).toBe(20); // 1000 * 2 / 100
    expect(r.stopDistance).toBe(4); // |100 - 96|
    expect(r.stopDistancePercent).toBe(4); // 4 / 100 * 100
    expect(r.positionUnits).toBe(5); // 20 / 4
    expect(r.positionNotional).toBe(500); // 5 * 100
  });
});

describe("calculateRisk — valid short", () => {
  const r = calc({ entryPrice: "100", stopPrice: "104" });
  it("is valid and short (stop above entry)", () => {
    expect(r.status).toBe("valid");
    if (r.status === "valid") {
      expect(r.direction).toBe("short");
      expect(r.stopDistance).toBe(4);
      expect(r.positionUnits).toBe(5);
      expect(r.positionNotional).toBe(500);
    }
  });
});

describe("calculateRisk — invalid ranges", () => {
  it("equal entry and stop is invalid, tagged on stopPrice, no direction", () => {
    const r = calc({ stopPrice: "100" });
    expect(r.status).toBe("invalid");
    if (r.status === "invalid") expect(r.fields.stopPrice).toBe("equal");
  });
  it("capital zero is invalid", () => {
    const r = calc({ capital: "0" });
    expect(r.status).toBe("invalid");
    if (r.status === "invalid") expect(r.fields.capital).toBe("nonPositive");
  });
  it("risk zero is invalid", () => {
    const r = calc({ riskPercent: "0" });
    if (r.status === "invalid") expect(r.fields.riskPercent).toBe("nonPositive");
    else throw new Error("expected invalid");
  });
  it("risk over 100 is invalid", () => {
    const r = calc({ riskPercent: "101" });
    if (r.status === "invalid") expect(r.fields.riskPercent).toBe("over100");
    else throw new Error("expected invalid");
  });
  it("risk exactly 100 is allowed", () => {
    expect(calc({ riskPercent: "100" }).status).toBe("valid");
  });
  it("entry zero is invalid", () => {
    const r = calc({ entryPrice: "0" });
    if (r.status === "invalid") expect(r.fields.entryPrice).toBe("nonPositive");
    else throw new Error("expected invalid");
  });
  it("stop zero is invalid", () => {
    const r = calc({ stopPrice: "0" });
    if (r.status === "invalid") expect(r.fields.stopPrice).toBe("nonPositive");
    else throw new Error("expected invalid");
  });
});

describe("calculateRisk — numeric safety", () => {
  it("tiny stop distance preserves small fractional units, no NaN/Infinity", () => {
    const r = calc({ entryPrice: "100", stopPrice: "99.9999", capital: "1000", riskPercent: "1" });
    expect(r.status).toBe("valid");
    if (r.status === "valid") {
      expect(Number.isFinite(r.positionUnits)).toBe(true);
      expect(Number.isFinite(r.positionNotional)).toBe(true);
      expect(r.stopDistance).toBeCloseTo(0.0001, 10);
      expect(r.positionUnits).toBeGreaterThan(0);
    }
  });

  it("never yields NaN or Infinity for a valid result", () => {
    const r = calc({ entryPrice: "0.00000001", stopPrice: "0.00000002", capital: "1000", riskPercent: "1" });
    if (r.status === "valid") {
      for (const n of [r.riskAmount, r.stopDistance, r.stopDistancePercent, r.positionUnits, r.positionNotional]) {
        expect(Number.isFinite(n)).toBe(true);
      }
    }
  });

  it("fails closed as invalid when a value overflows the displayable range", () => {
    // Enormous capital + microscopic distance → position beyond MAX_DISPLAYABLE.
    const r = calc({
      capital: "999999999999999",
      riskPercent: "100",
      entryPrice: "100",
      stopPrice: "99.9999",
    });
    expect(r.status).toBe("invalid");
    if (r.status === "invalid") expect(r.general).toBe("range");
  });
});

describe("formatNumber / formatPercent — deterministic RU output", () => {
  it("formats integers without grouping or a currency symbol", () => {
    expect(formatNumber(500, PRECISION.amount)).toBe("500");
    expect(formatNumber(1000000, PRECISION.amount)).toBe("1000000");
  });
  it("uses a comma decimal separator and strips trailing zeros", () => {
    expect(formatNumber(1000.5, PRECISION.amount)).toBe("1000,5");
    expect(formatNumber(5, PRECISION.units)).toBe("5");
  });
  it("never renders -0", () => {
    expect(formatNumber(-0, PRECISION.amount)).toBe("0");
    expect(formatNumber(0, PRECISION.amount)).toBe("0");
  });
  it("degrades non-finite input to a dash, never NaN/Infinity", () => {
    expect(formatNumber(NaN, PRECISION.amount)).toBe("—");
    expect(formatNumber(Infinity, PRECISION.amount)).toBe("—");
  });
  it("uses no scientific notation for a small fraction", () => {
    const s = formatNumber(0.0001, PRECISION.units);
    expect(s).toBe("0,0001");
    expect(s).not.toMatch(/e/i);
  });
  it("appends a percent sign to a percentage", () => {
    expect(formatPercent(4)).toBe("4%");
    expect(formatPercent(0.5)).toBe("0,5%");
  });
});
