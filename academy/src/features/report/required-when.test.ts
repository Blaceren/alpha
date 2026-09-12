import { describe, it, expect } from "vitest";
import { isRequiredWhenActive, isFieldEffectivelyRequired } from "@/features/report/required-when";
import { buildReportDefinition } from "@/features/report/report-definition";
import { buildPresentation } from "@/features/report/test-fixtures";
import type { ReportRequiredWhen } from "@/lib/report/types";

const rule = (value: ReportRequiredWhen["value"]): ReportRequiredWhen => ({ fieldCode: "trade1-plan-followed", operator: "equals", value });

describe("requiredWhen evaluator — strict boolean semantics", () => {
  it("is active only when the controller equals false", () => {
    expect(isRequiredWhenActive(rule(false), { "trade1-plan-followed": false })).toBe(true);
    expect(isRequiredWhenActive(rule(false), { "trade1-plan-followed": true })).toBe(false);
  });

  it("does not coerce 0, \"false\" or undefined to boolean false", () => {
    expect(isRequiredWhenActive(rule(false), { "trade1-plan-followed": 0 })).toBe(false);
    expect(isRequiredWhenActive(rule(false), { "trade1-plan-followed": "false" })).toBe(false);
    expect(isRequiredWhenActive(rule(false), {})).toBe(false);
    expect(isRequiredWhenActive(rule(false), { "trade1-plan-followed": undefined })).toBe(false);
  });

  it("handles string and null rule values with strict equality", () => {
    expect(isRequiredWhenActive({ fieldCode: "x", operator: "equals", value: "a" }, { x: "a" })).toBe(true);
    expect(isRequiredWhenActive({ fieldCode: "x", operator: "equals", value: "a" }, { x: "b" })).toBe(false);
    expect(isRequiredWhenActive({ fieldCode: "x", operator: "equals", value: null }, { x: null })).toBe(true);
    expect(isRequiredWhenActive({ fieldCode: "x", operator: "equals", value: null }, { x: 0 })).toBe(false);
  });
});

describe("all five trade requiredWhen rules", () => {
  const model = buildReportDefinition(buildPresentation());

  it("each deviation-note is required only when its plan-followed is false", () => {
    for (let n = 1; n <= 5; n += 1) {
      const note = model.byKey.get(`trade${n}-deviation-note`)!;
      expect(note.requiredWhen).toEqual({ fieldCode: `trade${n}-plan-followed`, operator: "equals", value: false });
      // false → required
      expect(isFieldEffectivelyRequired(note, { [`trade${n}-plan-followed`]: false })).toBe(true);
      // true → not required
      expect(isFieldEffectivelyRequired(note, { [`trade${n}-plan-followed`]: true })).toBe(false);
    }
  });

  it("a statically required field stays required regardless of values", () => {
    const instrument = model.byKey.get("trade1-instrument")!;
    expect(isFieldEffectivelyRequired(instrument, {})).toBe(true);
  });
});
