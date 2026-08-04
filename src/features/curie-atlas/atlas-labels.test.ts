/**
 * AFD-5D2 — Atlas copy, and the one derived value in this feature.
 *
 * `deriveResultStatus` is the only place the CRM adds a concept the DTO does not
 * carry, so it gets the most scrutiny here: it must never contradict the
 * backend, and it must be built only from facts the backend itself stated.
 */
import { describe, expect, it } from "vitest";
import {
  ATLAS_MODE_BADGE,
  ATLAS_SUBTITLE,
  ATLAS_TITLE,
  INSUFFICIENCY_REASON_FALLBACK,
  RESULT_STATUS_LABEL,
  SECTION_HEADING,
  adjustmentHintFor,
  deriveResultStatus,
  headlineMetricLabel,
  insufficiencyReasonLabel,
  isKnownInsufficiencyReason,
} from "./atlas-labels";
import {
  atlasReport,
  evidence,
  finding,
  insufficientReport,
  limitedReport,
} from "@/test/atlas-fixtures";

describe("atlas copy", () => {
  it("uses the required section headings", () => {
    expect(SECTION_HEADING.observation).toBe("Наблюдения");
    expect(SECTION_HEADING.warning).toBe("Предупреждения");
    expect(SECTION_HEADING.positive_signal).toBe("Положительные сигналы");
    expect(SECTION_HEADING.question).toBe("Вопросы к данным");
  });

  it("names the product honestly and never as generative AI", () => {
    expect(ATLAS_TITLE).toBe("Curie Atlas");
    expect(ATLAS_SUBTITLE).toBe("Детерминированный анализ трафика");
    expect(ATLAS_MODE_BADGE).toBe("Без модели");
  });

  it("never uses a forbidden marketing word anywhere in the copy", async () => {
    // The brief forbids labelling this as generative AI, a recommendation
    // engine, a traffic-quality predictor or a forecasting agent.
    const labels = await import("./atlas-labels");
    const strings: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(labels);

    const haystack = strings.join(" ").toLowerCase();
    for (const forbidden of [
      "нейросет",
      "искусственн",
      "генеративн",
      "gpt",
      "рекомендуем",
      "качество трафика",
    ]) {
      expect(haystack).not.toContain(forbidden);
    }
    // "прогноз" appears only in the sentence that says forecasts are NOT made.
    const forecastMentions = strings.filter((s) => s.toLowerCase().includes("прогноз"));
    for (const mention of forecastMentions) {
      expect(mention.toLowerCase()).toMatch(/не строятся|недоступ/);
    }
  });

  it("labels a known headline metric and passes an unknown key through", () => {
    expect(headlineMetricLabel("qualifiedClicks")).toBe("Засчитанные клики");
    expect(headlineMetricLabel("someNewMetric")).toBe("someNewMetric");
  });
});

describe("insufficiency reasons", () => {
  it("labels the two codes this backend emits", () => {
    expect(insufficiencyReasonLabel("no_events_in_period")).toContain("нет событий");
    expect(insufficiencyReasonLabel("empty_cohort")).toContain("нет учеников");
    expect(isKnownInsufficiencyReason("no_events_in_period")).toBe(true);
  });

  it("labels the forward-compatible codes the brief names", () => {
    for (const code of [
      "SAMPLE_TOO_SMALL",
      "COHORT_FOLLOWUP_INCOMPLETE",
      "MIXED_CURRENCY",
      "COMPARISON_PERIOD_UNAVAILABLE",
      "BREAKDOWN_TRUNCATED",
    ]) {
      expect(isKnownInsufficiencyReason(code)).toBe(true);
      expect(insufficiencyReasonLabel(code)).not.toBe(INSUFFICIENCY_REASON_FALLBACK);
    }
  });

  it("falls back safely on an unknown code instead of guessing", () => {
    expect(insufficiencyReasonLabel("WHAT_IS_THIS")).toBe(INSUFFICIENCY_REASON_FALLBACK);
    expect(isKnownInsufficiencyReason("WHAT_IS_THIS")).toBe(false);
  });

  it("offers an adjustment hint ONLY when the reason supports one", () => {
    expect(adjustmentHintFor("no_events_in_period")).not.toBeNull();
    expect(adjustmentHintFor("empty_cohort")).not.toBeNull();
    // Widening a period does not fix mixed currency, and saying so would be
    // advice that cannot work.
    expect(adjustmentHintFor("MIXED_CURRENCY")).toBeNull();
    expect(adjustmentHintFor("COMPARISON_PERIOD_UNAVAILABLE")).toBeNull();
    expect(adjustmentHintFor("WHAT_IS_THIS")).toBeNull();
  });

  it("never claims more traffic will solve the problem", () => {
    for (const code of ["no_events_in_period", "empty_cohort", "SAMPLE_TOO_SMALL"]) {
      const hint = adjustmentHintFor(code) ?? "";
      expect(hint.toLowerCase()).not.toContain("больше трафика");
      expect(hint.toLowerCase()).not.toContain("увеличьте трафик");
    }
  });
});

describe("deriveResultStatus", () => {
  it("returns ok for a sufficient report with no availability caveat", () => {
    expect(deriveResultStatus(atlasReport())).toBe("ok");
  });

  it("returns insufficient_data whenever the backend says so", () => {
    expect(deriveResultStatus(insufficientReport())).toBe("insufficient_data");
  });

  it("returns partial when the backend cited an availability operand", () => {
    expect(deriveResultStatus(limitedReport())).toBe("partial");
  });

  it("returns partial when the backend cited an integrity operand", () => {
    const report = atlasReport({
      warnings: [
        finding({
          code: "series_reconciliation_mismatch",
          section: "warning",
          severity: "attention",
          message: "Сумма по интервалам не совпадает с итогом периода.",
          evidence: [evidence({ key: "seriesTotal", value: "1230", source: "integrity" })],
        }),
      ],
    });
    expect(deriveResultStatus(report)).toBe("partial");
  });

  it("NEVER overrides an insufficient_data verdict, even with no caveats", () => {
    // The derived value may narrow the presentation, never contradict the
    // backend. This is the property that keeps it honest.
    const report = insufficientReport();
    expect(report.warnings).toEqual([]);
    expect(deriveResultStatus(report)).toBe("insufficient_data");
  });

  it("NEVER promotes a sufficient report to insufficient_data", () => {
    const noisy = atlasReport({
      warnings: [
        finding({ section: "warning", severity: "attention", evidence: [evidence()] }),
        finding({ section: "warning", severity: "attention", evidence: [evidence()] }),
      ],
    });
    // Many warnings, none of them availability- or integrity-sourced.
    expect(deriveResultStatus(noisy)).toBe("ok");
  });

  it("labels all three presentation states", () => {
    expect(RESULT_STATUS_LABEL.ok).toBe("Данных достаточно");
    expect(RESULT_STATUS_LABEL.partial).toContain("ограничени");
    expect(RESULT_STATUS_LABEL.insufficient_data).toBe("Недостаточно данных");
  });
});
