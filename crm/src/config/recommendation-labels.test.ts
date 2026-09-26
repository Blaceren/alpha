/**
 * Recommendation label consistency (Phase 1B3.1, D-52).
 *
 * One recommendation code must have ONE Russian wording everywhere: Users,
 * Today, User 360 and any future audit record naming the action. Before D-52 two
 * independent maps existed and three of them had drifted apart.
 *
 * These tests pin the CONTRACT, not the current implementation: deriving
 * RECOMMENDATION_LABEL from the catalog is what makes divergence unrepresentable
 * today, but re-hardcoding a second map tomorrow must fail here.
 */
import { describe, expect, it } from "vitest";
import {
  RECOMMENDATION_CATALOG,
  type RecommendedActionCode,
} from "@/domain/recommendations/catalog";
import { RECOMMENDATION_LABEL } from "./labels";

const CODES = Object.keys(RECOMMENDATION_CATALOG) as RecommendedActionCode[];
const CYRILLIC = /[А-Яа-яЁё]/;

describe("recommendation label map — one source", () => {
  it("covers exactly the catalog's code set", () => {
    expect(Object.keys(RECOMMENDATION_LABEL).sort()).toEqual([...CODES].sort());
  });

  it("has exactly 18 recommendation codes", () => {
    expect(CODES).toHaveLength(18);
    expect(Object.keys(RECOMMENDATION_LABEL)).toHaveLength(18);
  });

  it("words every code exactly as the catalog title", () => {
    for (const code of CODES) {
      expect(RECOMMENDATION_LABEL[code], `label for ${code} diverges from catalog.title`).toBe(
        RECOMMENDATION_CATALOG[code].title,
      );
    }
  });

  it("gives every code a non-empty Russian label", () => {
    for (const code of CODES) {
      const label = RECOMMENDATION_LABEL[code];
      expect(label, `missing label for ${code}`).toBeTruthy();
      expect(label, `label for ${code} is not Russian: ${label}`).toMatch(CYRILLIC);
    }
  });

  it("never words a label as the raw code", () => {
    for (const code of CODES) {
      expect(RECOMMENDATION_LABEL[code]).not.toContain("_");
      expect(RECOMMENDATION_LABEL[code].toLowerCase()).not.toBe(code.replace(/_/g, " "));
    }
  });

  /**
   * The types make an unknown code unrepresentable: both maps are exhaustive
   * `Record<RecommendedActionCode, …>`, so there is no runtime fallback to test
   * and adding one would only hide a compile error. What IS worth pinning is
   * that no code resolves to `undefined` at runtime.
   */
  it("resolves every code at runtime (no undefined lookup)", () => {
    for (const code of CODES) {
      expect(typeof RECOMMENDATION_LABEL[code]).toBe("string");
    }
  });
});

/**
 * The three that actually drifted. Pinned as literals — the point of D-52 is
 * that the FULLER catalog wording won, so a silent revert to the shorter variant
 * must fail loudly rather than pass a self-referential "label === title" check.
 */
describe("recommendation labels — the three D-52 divergences", () => {
  const CANONICAL: Record<string, string> = {
    remind_email_confirmation: "Напомнить о подтверждении email",
    review_risk_material: "Предложить материал по управлению риском",
    celebrate_learning_return: "Отметить возвращение к обучению",
  };

  const SUPERSEDED = [
    "Напомнить подтвердить email",
    "Материал по управлению риском",
    "Отметить возвращение",
  ];

  for (const [code, wording] of Object.entries(CANONICAL)) {
    it(`${code} reads «${wording}» in both the catalog and the label map`, () => {
      expect(RECOMMENDATION_CATALOG[code as RecommendedActionCode].title).toBe(wording);
      expect(RECOMMENDATION_LABEL[code as RecommendedActionCode]).toBe(wording);
    });
  }

  it("no superseded shorter wording survives anywhere in the map", () => {
    const all = Object.values(RECOMMENDATION_LABEL);
    for (const old of SUPERSEDED) {
      expect(all, `superseded wording is back: ${old}`).not.toContain(old);
    }
  });
});
