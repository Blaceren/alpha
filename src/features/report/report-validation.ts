/**
 * Client-side report validation (pure, fully testable).
 *
 * This mirrors the Backend field rules to give the learner immediate, bounded
 * feedback and to gate the submit button. It is GUIDANCE ONLY — the Backend
 * re-validates every field and its verdict is final. A value that passes here but
 * fails on the server is surfaced from the server error envelope, never hidden.
 */
import { isFieldEffectivelyRequired } from "@/features/report/required-when";
import type { ReportDefinitionModel } from "@/features/report/report-definition";
import type { ReportFieldDefinition } from "@/lib/report/types";

export type ReportFieldError = { stableKey: string; message: string };

const MAX_TEXT = 16_000;

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function validateOne(field: ReportFieldDefinition, raw: unknown): string | null {
  const v = field.validation ?? {};
  switch (field.type) {
    case "short_text":
    case "long_text": {
      if (typeof raw !== "string") return "Ожидается текст.";
      const text = raw.trim();
      const min = typeof v.minLength === "number" ? v.minLength : 0;
      const max = typeof v.maxLength === "number" ? v.maxLength : MAX_TEXT;
      if (text.length < min) return `Не короче ${min} символов.`;
      if (text.length > max) return `Не длиннее ${max} символов.`;
      return null;
    }
    case "url": {
      if (typeof raw !== "string") return "Ожидается ссылка.";
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return "Некорректная ссылка.";
      }
      if (url.protocol !== "https:" || url.username || url.password) return "Ссылка должна быть по HTTPS без логина и пароля.";
      return null;
    }
    case "integer": {
      if (typeof raw !== "number" || !Number.isSafeInteger(raw)) return "Ожидается целое число.";
      const min = typeof v.minValue === "number" ? v.minValue : Number.MIN_SAFE_INTEGER;
      const max = typeof v.maxValue === "number" ? v.maxValue : Number.MAX_SAFE_INTEGER;
      if (raw < min) return `Не меньше ${min}.`;
      if (raw > max) return `Не больше ${max}.`;
      return null;
    }
    case "boolean":
      if (typeof raw !== "boolean") return "Выберите вариант.";
      return null;
    case "single_choice": {
      const codes = new Set(field.choices.map((c) => c.code));
      if (typeof raw !== "string" || !codes.has(raw)) return "Выберите один из вариантов.";
      return null;
    }
    case "multi_choice": {
      const codes = new Set(field.choices.map((c) => c.code));
      if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string" || !codes.has(item))) return "Выберите из предложенных вариантов.";
      if (new Set(raw).size !== raw.length) return "Повторяющийся выбор.";
      const max = typeof v.maxSelections === "number" ? v.maxSelections : field.choices.length;
      if (raw.length > max) return `Не более ${max} вариантов.`;
      return null;
    }
    default:
      // Unsupported type: fail visibly (the adapter also reports it separately).
      return "Неподдерживаемый тип поля.";
  }
}

/**
 * Validate the whole report against the definition and current values. Returns
 * one error per invalid field, in definition (DOM) order. A field that is
 * effectively required (static OR active requiredWhen) and blank yields a
 * "required" error; a present value is checked against its type/rules.
 */
export function validateReport(
  model: ReportDefinitionModel,
  values: Record<string, unknown>,
): ReportFieldError[] {
  const errors: ReportFieldError[] = [];
  for (const field of model.orderedFields) {
    const raw = values[field.stableKey];
    const required = isFieldEffectivelyRequired(field, values);
    if (isBlank(raw)) {
      if (required) {
        const reason = field.requiredWhen && !field.required
          ? "Обязательно, так как отклонились от плана."
          : "Обязательное поле.";
        errors.push({ stableKey: field.stableKey, message: reason });
      }
      continue; // a blank optional field is valid
    }
    const message = validateOne(field, raw);
    if (message) errors.push({ stableKey: field.stableKey, message });
  }
  return errors;
}

/** True when the report has no client-side validation errors. */
export function isReportValid(model: ReportDefinitionModel, values: Record<string, unknown>): boolean {
  return validateReport(model, values).length === 0;
}
