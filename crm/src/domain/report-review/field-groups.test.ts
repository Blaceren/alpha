import { describe, expect, it } from "vitest";
import {
  groupReportFields,
  isConditionalNote,
  presentValue,
  tradeGroupCount,
} from "./field-groups";
import type { ReportFieldDefinition, ReportFieldValue } from "@/data/contracts/api/report-review";

function def(code: string, type: string, required = true, label = code): ReportFieldDefinition {
  return { code, type, required, label, helpText: null };
}

/** A miniature stand-in for the published 43-field definition. */
function realisticDefinitions(trades = 5): ReportFieldDefinition[] {
  const out: ReportFieldDefinition[] = [def("confirm-demo-only", "boolean")];
  for (let n = 1; n <= trades; n += 1) {
    out.push(
      def(`trade${n}-asset`, "short_text"),
      def(`trade${n}-direction`, "single_choice"),
      def(`trade${n}-plan-followed`, "boolean"),
      def(`trade${n}-deviation-note`, "long_text", false),
    );
  }
  out.push(def("summary-repeated-pattern", "long_text"), def("summary-next-session-rule", "long_text"));
  return out;
}

describe("groupReportFields — grouping is derived, not hardcoded", () => {
  it("produces general, five trades and summary from the published codes", () => {
    const groups = groupReportFields(realisticDefinitions(5), {});
    expect(groups.map((g) => g.key)).toEqual([
      "general", "trade-1", "trade-2", "trade-3", "trade-4", "trade-5", "summary",
    ]);
    expect(tradeGroupCount(groups)).toBe(5);
  });

  it("follows the definition rather than assuming five trades", () => {
    // The whole point of deriving: a different package renders differently.
    expect(tradeGroupCount(groupReportFields(realisticDefinitions(3), {}))).toBe(3);
    expect(tradeGroupCount(groupReportFields(realisticDefinitions(7), {}))).toBe(7);
  });

  it("orders trades numerically, not lexicographically", () => {
    const defs = [def("trade10-asset", "short_text"), def("trade2-asset", "short_text")];
    expect(groupReportFields(defs, {}).map((g) => g.tradeNumber)).toEqual([2, 10]);
  });

  it("preserves the backend field order inside a group", () => {
    const defs = [def("trade1-z", "short_text"), def("trade1-a", "short_text")];
    const groups = groupReportFields(defs, {});
    expect(groups[0]!.fields.map((f) => f.definition.code)).toEqual(["trade1-z", "trade1-a"]);
  });

  it("never drops an unrecognised code", () => {
    // Silently hiding a field a mentor must review is the one unacceptable bug.
    const defs = [def("brand-new-section-thing", "short_text"), def("trade1-asset", "short_text")];
    const groups = groupReportFields(defs, {});
    const all = groups.flatMap((g) => g.fields.map((f) => f.definition.code));
    expect(all).toContain("brand-new-section-thing");
  });

  it("treats a malformed trade index as general rather than inventing a group", () => {
    const groups = groupReportFields([def("trade0-asset", "short_text")], {});
    expect(groups.map((g) => g.kind)).toEqual(["general"]);
  });

  it("marks a field with no submitted value as missing", () => {
    const groups = groupReportFields([def("trade1-asset", "short_text")], {});
    expect(groups[0]!.fields[0]!.missing).toBe(true);
    const withValue = groupReportFields([def("trade1-asset", "short_text")], { "trade1-asset": "BTC" });
    expect(withValue[0]!.fields[0]!.missing).toBe(false);
  });

  it("omits an empty group entirely", () => {
    expect(groupReportFields([def("trade1-asset", "short_text")], {}).map((g) => g.key)).toEqual(["trade-1"]);
  });
});

describe("presentValue — typed, never coerced", () => {
  const present = (d: ReportFieldDefinition, value: ReportFieldValue | undefined) =>
    presentValue({ definition: d, value, missing: value === undefined });

  it("renders booleans as booleans", () => {
    expect(present(def("a", "boolean"), true)).toEqual({ kind: "boolean", value: true });
    expect(present(def("a", "boolean"), false)).toEqual({ kind: "boolean", value: false });
  });

  it("renders text types as text", () => {
    for (const type of ["short_text", "long_text", "url"]) {
      expect(present(def("a", type), "hello")).toEqual({ kind: "text", value: "hello" });
    }
  });

  it("renders numbers as numbers", () => {
    expect(present(def("a", "integer"), 3)).toEqual({ kind: "number", value: 3 });
  });

  it("renders a single choice as a stable code, never a guessed label", () => {
    // The reviewer DTO ships no localized choice labels, so the code is the only
    // honest rendering. CRM must not invent a translation.
    expect(present(def("a", "single_choice"), "up")).toEqual({ kind: "code", value: "up" });
  });

  it("renders a multi choice as a code list", () => {
    expect(present(def("a", "multi_choice"), ["x", "y"])).toEqual({ kind: "codeList", values: ["x", "y"] });
  });

  it("reports an absent optional value as absent", () => {
    expect(present(def("a", "long_text", false), undefined)).toEqual({ kind: "absent" });
  });

  it("reports an absent REQUIRED value as unsupported, not absent", () => {
    const result = present(def("a", "long_text", true), undefined);
    expect(result.kind).toBe("unsupported");
  });

  it("fails visibly when the runtime shape contradicts the declared type", () => {
    // A boolean field carrying a string must not render as "true".
    for (const [type, value] of [
      ["boolean", "yes"],
      ["short_text", 42],
      ["integer", "3"],
      ["single_choice", 7],
      ["multi_choice", "x"],
    ] as Array<[string, ReportFieldValue]>) {
      const result = present(def("a", type), value);
      expect(result.kind, `${type} accepted ${JSON.stringify(value)}`).toBe("unsupported");
    }
  });

  it("fails visibly for an unknown declared type", () => {
    const result = present(def("a", "quantum_slider"), "whatever");
    expect(result).toMatchObject({ kind: "unsupported", declaredType: "quantum_slider" });
  });

  it("truncates a long raw preview", () => {
    const result = present(def("a", "boolean"), "z".repeat(500));
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") expect(result.rawPreview.length).toBeLessThan(200);
  });
});

describe("isConditionalNote", () => {
  it("recognises the deviation note fields", () => {
    expect(isConditionalNote(def("trade3-deviation-note", "long_text"))).toBe(true);
    expect(isConditionalNote(def("trade3-asset", "short_text"))).toBe(false);
  });
});
