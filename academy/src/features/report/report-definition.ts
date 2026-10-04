/**
 * Report definition adapter (pure, fully testable).
 *
 * Turns the Backend-authoritative `ReportPresentation.assignment.fields` into a
 * deterministic, grouped structure the form renders. It NEVER hardcodes a
 * report's fields as the Academy schema — the field set, order, types and rules
 * all come from the DTO. Grouping is derived from the stable key prefix, so the
 * records of a report fall out of the data, not a constant.
 *
 * RECORDS (2026-10-02). A report is a list of RECORDS plus, sometimes, a few
 * closing fields. The 100-level program's report has five trade records
 * (`trade1-…` … `trade5-…`) and a summary. The 30-level program's first report
 * has five trade records and up to three REFUSAL records (`refusal1-…`): «отказы
 * записываются наравне со сделками». Both prefixes are record kinds here, each
 * with its own heading, and anything unprefixed is the closing group.
 *
 * AN OPTIONAL RECORD HAS A SWITCH. A boolean field named `<record>-added`
 * («добавить ещё одну запись отказа») is not a question to answer but the
 * record's own on/off: the record's fields are required only when it is true
 * (the Backend's `requiredWhen` says so), and the form shows them only then.
 * The adapter lifts that field out of the record's field list as `switchField`
 * so the form can render it as «добавить / убрать» rather than as a «Да / Нет»
 * question sitting above five empty inputs.
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

export type ReportRecordKind = "trade" | "refusal";

export type ReportFieldGroup = {
  /** Stable group id: `trade-1` …, `refusal-1` …, or `summary`. */
  id: string;
  /** RU section label. */
  label: string;
  /** What kind of record this is, or `summary` for the closing fields. */
  kind: ReportRecordKind | "summary";
  /** 1-based trade index; null for every group that is not a trade record. */
  tradeIndex: number | null;
  /** The fields a learner fills, in order. Never includes `switchField`. */
  fields: ReportFieldDefinition[];
  /**
   * The record's own on/off field, when the record is optional. The record's
   * fields are shown and required only while its value is exactly `true`.
   */
  switchField: ReportFieldDefinition | null;
};

export type ReportDefinitionModel = {
  fieldCount: number;
  /** Deterministically ordered groups: records in order of appearance, then summary. */
  groups: ReportFieldGroup[];
  /** Flat, deterministically ordered field list (matches DOM order). */
  orderedFields: ReportFieldDefinition[];
  /** Stable keys whose declared type the renderer does not support. */
  unknownTypes: Array<{ stableKey: string; type: string }>;
  /** Fast lookup by stable key. */
  byKey: Map<string, ReportFieldDefinition>;
  /** The group each field belongs to (switch fields included). */
  groupOf: Map<string, ReportFieldGroup>;
};

const RECORD_PREFIX_RE = /^(trade|refusal)(\d+)-(.+)$/;
const RECORD_LABEL: Record<ReportRecordKind, string> = { trade: "Сделка", refusal: "Отказ" };
const SWITCH_SUFFIX = "added";

/** Deterministic order: by sortOrder, then by stableKey as a stable tie-break. */
function orderFields(fields: readonly ReportFieldDefinition[]): ReportFieldDefinition[] {
  return [...fields].sort((a, b) => a.sortOrder - b.sortOrder || a.stableKey.localeCompare(b.stableKey));
}

function recordOf(stableKey: string): { kind: ReportRecordKind; index: number; suffix: string } | null {
  const match = RECORD_PREFIX_RE.exec(stableKey);
  if (!match) return null;
  const index = Number(match[2]);
  if (!Number.isSafeInteger(index) || index <= 0) return null;
  return { kind: match[1] as ReportRecordKind, index, suffix: match[3] as string };
}

/**
 * Is this field the on/off of its record?
 *
 * Three conditions, all of them: it is named `<record>-added`, it is a boolean,
 * and at least one other field of the same record is required exactly when it
 * is `true`. A boolean that merely happens to be called «added» and switches
 * nothing stays an ordinary question.
 */
function isRecordSwitch(field: ReportFieldDefinition, siblings: readonly ReportFieldDefinition[]): boolean {
  const record = recordOf(field.stableKey);
  if (!record || record.suffix !== SWITCH_SUFFIX || field.type !== "boolean") return false;
  return siblings.some(
    (other) =>
      other.stableKey !== field.stableKey &&
      other.requiredWhen?.fieldCode === field.stableKey &&
      other.requiredWhen.operator === "equals" &&
      other.requiredWhen.value === true,
  );
}

export function buildReportDefinition(presentation: ReportPresentation): ReportDefinitionModel {
  const orderedFields = orderFields(presentation.assignment.fields);
  const byKey = new Map(orderedFields.map((field) => [field.stableKey, field]));

  const unknownTypes = orderedFields
    .filter((field) => !isReportFieldType(field.type))
    .map((field) => ({ stableKey: field.stableKey, type: field.type }));

  // Bucket by derived record while preserving field order within each bucket.
  // Insertion order of the map is the order records first appear in.
  const buckets = new Map<string, { kind: ReportRecordKind; index: number; fields: ReportFieldDefinition[] }>();
  const summary: ReportFieldDefinition[] = [];
  for (const field of orderedFields) {
    const record = recordOf(field.stableKey);
    if (!record) {
      summary.push(field);
      continue;
    }
    const id = `${record.kind}-${record.index}`;
    const bucket = buckets.get(id) ?? { kind: record.kind, index: record.index, fields: [] };
    bucket.fields.push(field);
    buckets.set(id, bucket);
  }

  const groups: ReportFieldGroup[] = [];
  // Trades first, then refusals, each by index — the order every published
  // report already has, stated rather than assumed.
  const ordered = [...buckets.entries()].sort(
    ([, a], [, b]) => (a.kind === b.kind ? a.index - b.index : a.kind === "trade" ? -1 : 1),
  );
  for (const [id, bucket] of ordered) {
    const switchField = bucket.fields.find((field) => isRecordSwitch(field, bucket.fields)) ?? null;
    groups.push({
      id,
      label: `${RECORD_LABEL[bucket.kind]} ${bucket.index}`,
      kind: bucket.kind,
      tradeIndex: bucket.kind === "trade" ? bucket.index : null,
      fields: switchField ? bucket.fields.filter((field) => field !== switchField) : bucket.fields,
      switchField,
    });
  }
  if (summary.length > 0) {
    groups.push({
      id: "summary",
      label: "Итоги и выводы",
      kind: "summary",
      tradeIndex: null,
      fields: summary,
      switchField: null,
    });
  }

  const groupOf = new Map<string, ReportFieldGroup>();
  for (const group of groups) {
    for (const field of group.fields) groupOf.set(field.stableKey, group);
    if (group.switchField) groupOf.set(group.switchField.stableKey, group);
  }

  return {
    fieldCount: orderedFields.length,
    groups,
    orderedFields,
    unknownTypes,
    byKey,
    groupOf,
  };
}

/** Is this record part of the report right now? Always, unless it has a switch that is off. */
export function isGroupActive(group: ReportFieldGroup, values: Record<string, unknown>): boolean {
  return group.switchField === null || values[group.switchField.stableKey] === true;
}

/** «Сделка 2 · Основание словами» — a field named so that six «Дата и время» can be told apart. */
export function qualifiedFieldLabel(model: ReportDefinitionModel, stableKey: string): string {
  const field = model.byKey.get(stableKey);
  const label = field?.label || stableKey;
  const group = model.groupOf.get(stableKey);
  return group && group.kind !== "summary" ? `${group.label} · ${label}` : label;
}

export { SUPPORTED_FIELD_TYPES };
