import { describe, it, expect } from "vitest";
import { buildReportDefinition } from "@/features/report/report-definition";
import { buildPresentation } from "@/features/report/test-fixtures";
import type { ReportPresentation } from "@/lib/report/types";

describe("report definition adapter", () => {
  it("exposes exactly 43 fields for the L3-shaped definition", () => {
    const model = buildReportDefinition(buildPresentation());
    expect(model.fieldCount).toBe(43);
    expect(model.orderedFields).toHaveLength(43);
  });

  it("orders fields deterministically by sortOrder then stableKey", () => {
    const model = buildReportDefinition(buildPresentation());
    const orders = model.orderedFields.map((f) => f.sortOrder);
    expect([...orders]).toEqual([...orders].sort((a, b) => a - b));
  });

  it("groups into five trade sections plus a summary section", () => {
    const model = buildReportDefinition(buildPresentation());
    const tradeGroups = model.groups.filter((g) => g.tradeIndex !== null);
    expect(tradeGroups.map((g) => g.tradeIndex)).toEqual([1, 2, 3, 4, 5]);
    const summary = model.groups.find((g) => g.id === "summary");
    expect(summary).toBeDefined();
    expect(summary!.fields.length).toBe(8);
    // sum of grouped fields equals the whole set (no field lost)
    expect(model.groups.reduce((n, g) => n + g.fields.length, 0)).toBe(43);
  });

  it("supports the field types the definition uses", () => {
    const model = buildReportDefinition(buildPresentation());
    const types = new Set(model.orderedFields.map((f) => f.type));
    expect(types).toContain("boolean");
    expect(types).toContain("short_text");
    expect(types).toContain("long_text");
    expect(types).toContain("single_choice");
    expect(types).toContain("integer");
    expect(model.unknownTypes).toHaveLength(0);
  });

  it("flags an unknown field type instead of silently dropping it", () => {
    const presentation = buildPresentation();
    (presentation.assignment.fields[0] as { type: string }).type = "mystery_widget";
    const model = buildReportDefinition(presentation as ReportPresentation);
    expect(model.fieldCount).toBe(43); // still present
    expect(model.unknownTypes).toEqual([{ stableKey: "trade1-instrument", type: "mystery_widget" }]);
  });

  it("carries no attachment metadata on any field", () => {
    const model = buildReportDefinition(buildPresentation());
    for (const field of model.orderedFields) {
      expect("attachment" in field).toBe(false);
      expect("upload" in field).toBe(false);
    }
  });
});
