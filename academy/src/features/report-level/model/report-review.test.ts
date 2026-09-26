import { describe, expect, it } from "vitest";
import {
  getReportDefinition,
  REPORT_LEVEL_NUMBER,
} from "@/features/report-level/data/report-fixtures";
import {
  entryFieldSectionId,
  knownSectionIds,
  resolveReportVerdictAdapter,
  resolveReviewTarget,
  reviewTargets,
  summarySectionId,
} from "@/features/report-level/model/report-review";

const definition = getReportDefinition(REPORT_LEVEL_NUMBER)!;

describe("section ids — a closed, derived set", () => {
  it("builds the authored scenario's two ids exactly as specified", () => {
    expect(entryFieldSectionId(3, 3, "noticed")).toBe("report.003.entry.3.noticed");
    expect(summarySectionId(3)).toBe("report.003.summary");
  });

  it("derives the full closed set: entryCount × 3 fields + summary", () => {
    const ids = knownSectionIds(definition);
    expect(ids.size).toBe(definition.entryCount * 3 + 1);
    expect(ids.has("report.003.entry.1.when")).toBe(true);
    expect(ids.has("report.003.summary")).toBe(true);
    // No free-form ids: nothing outside the derived set is known.
    expect(ids.has("report.003.entry.6.noticed")).toBe(false);
    expect(ids.has("report.004.summary")).toBe(false);
  });
});

describe("review targets — human labels, never raw ids", () => {
  it("labels an entry field «Запись NN · <field label>»", () => {
    const target = resolveReviewTarget(definition, "report.003.entry.3.noticed")!;
    expect(target.kind).toBe("entry-field");
    expect(target.ordinal).toBe(3);
    expect(target.label).toBe("Запись 03 · Что заметил после сделки");
    // The label never leaks the raw id.
    expect(target.label).not.toContain("report.003");
  });

  it("labels the summary with the definition's own summary label", () => {
    const target = resolveReviewTarget(definition, "report.003.summary")!;
    expect(target.kind).toBe("summary");
    expect(target.label).toBe("Итоговое наблюдение");
  });

  it("returns null for an id outside this report", () => {
    expect(resolveReviewTarget(definition, "report.014.entry.1.noticed")).toBeNull();
    expect(resolveReviewTarget(definition, "balance.total")).toBeNull();
  });

  it("orders targets by the LEDGER, not by the verdict payload", () => {
    const review = {
      comment: "к",
      // Deliberately reversed: summary first, then entry 3.
      sections: ["report.003.summary", "report.003.entry.3.noticed"],
      receivedAt: "2026-07-18",
      atRevision: 0,
    };
    const targets = reviewTargets(definition, review);
    expect(targets.map((t) => t.kind)).toEqual(["entry-field", "summary"]);
  });

  it("silently drops unresolvable sections from the target list", () => {
    const review = {
      comment: "к",
      sections: ["report.003.entry.2.when", "report.099.summary"],
      receivedAt: "2026-07-18",
      atRevision: 0,
    };
    expect(reviewTargets(definition, review)).toHaveLength(1);
  });

  it("yields no targets without a review", () => {
    expect(reviewTargets(definition, null)).toEqual([]);
  });
});

describe("dev/test verdict adapter resolver (DD-286, DD-298)", () => {
  it("resolves the two explicit verdict values exactly", () => {
    expect(resolveReportVerdictAdapter("revision-requested")).toBe("revision-requested");
    // D3-D adds the approved verdict — an exact match, never an alias.
    expect(resolveReportVerdictAdapter("approved")).toBe("approved");
  });

  it("fails closed on everything else — no alias, no rejected, ever resolves", () => {
    for (const raw of [
      "rejected",
      "auto-approved",
      "mentor-approved",
      "APPROVED",
      "revision",
      "",
      undefined,
      null,
      7,
      ["revision-requested"],
    ]) {
      expect(resolveReportVerdictAdapter(raw)).toBeNull();
    }
  });
});
