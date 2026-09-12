/**
 * Test-only fixture builder mirroring the SHAPE of the real L3 report definition
 * (43 fields, 5 trade groups, 5 `requiredWhen` deviation-note rules, summary
 * fields). This is NOT an authoritative schema — the isolated E2E uses the real
 * Backend definition. Unit/component tests use this to exercise the adapter,
 * validation, reducer and form without a running Backend.
 */
import type {
  ReportContext,
  ReportContextKind,
  ReportFieldDefinition,
  ReportPresentation,
  ReportSubmission,
} from "@/lib/report/types";

let order = 0;
function field(partial: Partial<ReportFieldDefinition> & Pick<ReportFieldDefinition, "stableKey" | "type">): ReportFieldDefinition {
  order += 1;
  return {
    required: false,
    sortOrder: order,
    validation: null,
    requiredWhen: null,
    choices: [],
    label: partial.stableKey,
    helpText: "",
    placeholder: "",
    ...partial,
  };
}

function tradeFields(n: number): ReportFieldDefinition[] {
  return [
    field({ stableKey: `trade${n}-instrument`, type: "short_text", required: true, validation: { minLength: 2, maxLength: 40 }, label: `Инструмент ${n}` }),
    field({ stableKey: `trade${n}-direction`, type: "single_choice", required: true, choices: [{ code: "long", label: "Long" }, { code: "short", label: "Short" }], label: `Направление ${n}` }),
    field({ stableKey: `trade${n}-entry`, type: "integer", required: true, validation: { minValue: 0, maxValue: 1_000_000 }, label: `Вход ${n}` }),
    field({ stableKey: `trade${n}-exit`, type: "integer", required: true, validation: { minValue: 0, maxValue: 1_000_000 }, label: `Выход ${n}` }),
    field({ stableKey: `trade${n}-plan-followed`, type: "boolean", required: true, label: `План соблюдён ${n}` }),
    field({
      stableKey: `trade${n}-deviation-note`,
      type: "long_text",
      required: false,
      validation: { minLength: 8, maxLength: 500 },
      requiredWhen: { fieldCode: `trade${n}-plan-followed`, operator: "equals", value: false },
      label: `Отклонение от плана ${n}`,
      helpText: "Заполните, если план не соблюдён.",
    }),
    field({ stableKey: `trade${n}-lesson`, type: "short_text", required: true, validation: { minLength: 4, maxLength: 120 }, label: `Вывод ${n}` }),
  ];
}

function summaryFields(): ReportFieldDefinition[] {
  return [
    field({ stableKey: "summary-total-trades", type: "integer", required: true, validation: { minValue: 1, maxValue: 50 }, label: "Всего сделок" }),
    field({ stableKey: "summary-best-trade", type: "short_text", required: true, validation: { minLength: 2, maxLength: 60 }, label: "Лучшая сделка" }),
    field({ stableKey: "summary-worst-trade", type: "short_text", required: true, validation: { minLength: 2, maxLength: 60 }, label: "Худшая сделка" }),
    field({ stableKey: "summary-emotional-state", type: "single_choice", required: true, choices: [{ code: "calm", label: "Спокойно" }, { code: "anxious", label: "Тревожно" }], label: "Состояние" }),
    field({ stableKey: "summary-rules-followed", type: "boolean", required: true, label: "Правила соблюдены" }),
    field({ stableKey: "summary-key-insight", type: "long_text", required: true, validation: { minLength: 10, maxLength: 800 }, label: "Ключевой вывод" }),
    field({ stableKey: "summary-next-focus", type: "long_text", required: true, validation: { minLength: 10, maxLength: 800 }, label: "Фокус далее" }),
    field({ stableKey: "summary-confidence", type: "integer", required: true, validation: { minValue: 1, maxValue: 10 }, label: "Уверенность" }),
  ];
}

export function buildPresentation(): ReportPresentation {
  order = 0;
  const fields = [
    ...tradeFields(1),
    ...tradeFields(2),
    ...tradeFields(3),
    ...tradeFields(4),
    ...tradeFields(5),
    ...summaryFields(),
  ];
  return {
    level: {
      levelNumber: 3,
      stableCode: "v2.l003.pervye-pyat-demo-sdelok",
      type: "report",
      title: "Первые пять демо-сделок",
      shortDescription: "Разбор первых сделок",
      learningObjective: "Научиться вести дневник сделок",
    },
    assignment: {
      versionNumber: 1,
      locale: "ru",
      title: "Отчёт по первым пяти сделкам",
      instructions: "Опишите каждую из пяти демо-сделок и подведите итоги.",
      successCriteriaSummary: "Полный разбор пяти сделок и осмысленные выводы.",
      submitLabel: "Отправить на проверку",
      fields,
    },
  };
}

/** A complete, valid set of field values for the fixture definition. */
export function validValues(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (let n = 1; n <= 5; n += 1) {
    values[`trade${n}-instrument`] = "EURUSD";
    values[`trade${n}-direction`] = "long";
    values[`trade${n}-entry`] = 100;
    values[`trade${n}-exit`] = 120;
    values[`trade${n}-plan-followed`] = true; // no deviation note required
    values[`trade${n}-lesson`] = "Держать риск";
  }
  values["summary-total-trades"] = 5;
  values["summary-best-trade"] = "Сделка 2";
  values["summary-worst-trade"] = "Сделка 4";
  values["summary-emotional-state"] = "calm";
  values["summary-rules-followed"] = true;
  values["summary-key-insight"] = "Дисциплина важнее прогноза.";
  values["summary-next-focus"] = "Уменьшить размер позиции.";
  values["summary-confidence"] = 6;
  return { ...values, ...overrides };
}

export function buildSubmission(partial: Partial<ReportSubmission> = {}): ReportSubmission {
  return {
    status: "draft",
    workflowVersion: 1,
    activeRevisionNumber: 1,
    submittedRevisionNumber: null,
    approvedRevisionNumber: null,
    fieldValues: {},
    firstSubmittedAt: null,
    submittedAt: null,
    rejection: null,
    history: [],
    ...partial,
  };
}

export function buildContext(kind: ReportContextKind, submission: ReportSubmission | null): ReportContext {
  return { ...buildPresentation(), kind, submission };
}
