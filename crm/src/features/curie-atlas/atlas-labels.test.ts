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
  RESULT_STATUS_LABEL,
  SECTION_HEADING,
  headlineMetricLabel,
  isKnownReasonCode,
  reasonCodeLabel,
  supportTierLabel,
} from "./atlas-labels";

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

describe("backend statuses are rendered, never derived", () => {
  it("labels all three backend statuses", () => {
    expect(RESULT_STATUS_LABEL.ok).toBe("Данных достаточно");
    expect(RESULT_STATUS_LABEL.partial).toContain("ограничени");
    expect(RESULT_STATUS_LABEL.insufficient_data).toBe("Недостаточно данных");
  });

  it("exports NO function that derives a status", async () => {
    const labels = await import("./atlas-labels");
    expect("deriveResultStatus" in labels).toBe(false);
    expect("AVAILABILITY_EVIDENCE_SOURCES" in labels).toBe(false);
  });

  it("labels every backend reason code and falls back safely", () => {
    for (const code of ([
      "SAMPLE_TOO_SMALL",
      "COHORT_FOLLOWUP_INCOMPLETE",
      "COMPARISON_PERIOD_UNAVAILABLE",
      "MIXED_CURRENCY",
      "BREAKDOWN_TRUNCATED",
      "METRIC_UNAVAILABLE",
      "INTEGRITY_WARNING",
    ] as const)) {
      expect(isKnownReasonCode(code)).toBe(true);
      // AFD-5D3: every published code has a REAL sentence. There is no fallback
      // to fall back to, so a missing label is a compile error, not prose.
      expect(reasonCodeLabel(code).length).toBeGreaterThan(10);
    }
    // An unknown code never reaches the labeller — the contract rejects the
    // response first — but `isKnownReasonCode` still answers honestly.
    expect(isKnownReasonCode("WHAT_IS_THIS")).toBe(false);
  });

  it("labels every support tier and passes an unknown one through", () => {
    expect(supportTierLabel("descriptive")).toBe("Описательный");
    expect(supportTierLabel("moderate")).toContain("Умеренная");
    expect(supportTierLabel("strong")).toContain("Сильная");
    expect(supportTierLabel("certain")).toBe("certain");
  });
});
