import { describe, it, expect } from "vitest";
import { validateReport, isReportValid } from "@/features/report/report-validation";
import { buildReportDefinition } from "@/features/report/report-definition";
import { buildPresentation, validValues } from "@/features/report/test-fixtures";

const model = buildReportDefinition(buildPresentation());

describe("report validation (client guidance)", () => {
  it("passes a fully valid 43-field report", () => {
    expect(validateReport(model, validValues())).toEqual([]);
    expect(isReportValid(model, validValues())).toBe(true);
  });

  it("flags a missing statically-required field", () => {
    const errors = validateReport(model, validValues({ "trade1-instrument": "" }));
    expect(errors.some((e) => e.stableKey === "trade1-instrument")).toBe(true);
  });

  it("requires the deviation note when the plan was not followed", () => {
    const values = validValues({ "trade2-plan-followed": false });
    const errors = validateReport(model, values);
    expect(errors.some((e) => e.stableKey === "trade2-deviation-note")).toBe(true);
    // once satisfied, the error clears
    const fixed = validateReport(model, { ...values, "trade2-deviation-note": "Отклонился из-за новостей." });
    expect(fixed.some((e) => e.stableKey === "trade2-deviation-note")).toBe(false);
  });

  it("does not require the deviation note when the plan was followed", () => {
    const errors = validateReport(model, validValues({ "trade3-plan-followed": true }));
    expect(errors.some((e) => e.stableKey === "trade3-deviation-note")).toBe(false);
  });

  it("enforces text length bounds", () => {
    const short = validateReport(model, validValues({ "trade1-instrument": "x" })); // min 2
    expect(short.some((e) => e.stableKey === "trade1-instrument")).toBe(true);
  });

  it("enforces integer range and type", () => {
    expect(validateReport(model, validValues({ "summary-confidence": 99 })).some((e) => e.stableKey === "summary-confidence")).toBe(true);
    expect(validateReport(model, validValues({ "summary-confidence": 5.5 })).some((e) => e.stableKey === "summary-confidence")).toBe(true);
  });

  it("enforces single-choice membership", () => {
    expect(validateReport(model, validValues({ "trade1-direction": "sideways" })).some((e) => e.stableKey === "trade1-direction")).toBe(true);
  });
});
