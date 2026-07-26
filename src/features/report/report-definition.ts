/**
 * Report definition adapter (pure, fully testable).
 *
 * Turns the Backend-authoritative `ReportPresentation.assignment.fields` into a
 * deterministic, grouped structure the form renders. It NEVER hardcodes the 43
 * approved fields as the Academy schema — the field set, order, types and rules
 * all come from the DTO. Grouping is derived from the stable `tradeN-` key
 * prefix so five trade groups + summary fields fall out of the data, not a
 * constant.
 *
 * An UNKNOWN field type is surfaced as a visible, safe failure (`unknownTypes`)
 * rather than silently dropped, so the form can fail closed.
 */
import {
  SUPPORTED_FIELD_TYPES,
  isReportFieldType,
  type ReportFieldDefinition,
  type ReportPresentation,
} from "@/lib/report/types";

export type ReportFieldGroup = {
  /** Stable group id: `trade-1` … or `summary`. */
  id: string;
  /** RU section label. */
  label: string;
  /** 1-based trade index, or null for the summary group. */
  tradeIndex: number | null;
  fields: ReportFieldDefinition[];
};

export type ReportDefinitionModel = {
  fieldCount: number;
  /** Deterministically ordered groups: trade-1..N, then summary. */
  groups: ReportFieldGroup[];
  /** Flat, deterministically ordered field list (matches DOM order). */
  orderedFields: ReportFieldDefinition[];
  /** Stable keys whose declared type the renderer does not support. */
  unknownTypes: Array<{ stableKey: string; type: string }>;
  /** Fast lookup by stable key. */
  byKey: Map<string, ReportFieldDefinition>;
};

const TRADE_PREFIX_RE = /^trade(\d+)-/;

/** Deterministic order: by sortOrder, then by stableKey as a stable tie-break. */
function orderFields(fields: readonly ReportFieldDefinition[]): ReportFieldDefinition[] {
  return [...fields].sort((a, b) => a.sortOrder - b.sortOrder || a.stableKey.localeCompare(b.stableKey));
}

function tradeIndexOf(stableKey: string): number | null {
  const match = TRADE_PREFIX_RE.exec(stableKey);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) && index > 0 ? index : null;
}

export function buildReportDefinition(presentation: ReportPresentation): ReportDefinitionModel {
  const orderedFields = orderFields(presentation.assignment.fields);
  const byKey = new Map(orderedFields.map((field) => [field.stableKey, field]));

  const unknownTypes = orderedFields
    .filter((field) => !isReportFieldType(field.type))
    .map((field) => ({ stableKey: field.stableKey, type: field.type }));

  // Bucket by derived group while preserving field order within each group.
  const tradeBuckets = new Map<number, ReportFieldDefinition[]>();
  const summary: ReportFieldDefinition[] = [];
  for (const field of orderedFields) {
    const tradeIndex = tradeIndexOf(field.stableKey);
    if (tradeIndex === null) {
      summary.push(field);
      continue;
    }
    const bucket = tradeBuckets.get(tradeIndex) ?? [];
    bucket.push(field);
    tradeBuckets.set(tradeIndex, bucket);
  }

  const groups: ReportFieldGroup[] = [];
  for (const tradeIndex of [...tradeBuckets.keys()].sort((a, b) => a - b)) {
    groups.push({
      id: `trade-${tradeIndex}`,
      label: `Сделка ${tradeIndex}`,
      tradeIndex,
      fields: tradeBuckets.get(tradeIndex)!,
    });
  }
  if (summary.length > 0) {
    groups.push({ id: "summary", label: "Итоги и выводы", tradeIndex: null, fields: summary });
  }

  return {
    fieldCount: orderedFields.length,
    groups,
    orderedFields,
    unknownTypes,
    byKey,
  };
}

export { SUPPORTED_FIELD_TYPES };
