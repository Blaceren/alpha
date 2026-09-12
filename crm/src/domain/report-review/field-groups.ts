/**
 * Semantic grouping of the report's fields, derived from the Backend definition.
 *
 * ## Why grouping is not a duplicate schema
 *
 * The reviewer DTO hands over a flat, ordered list of field definitions. Rendering
 * 43 fields as one undifferentiated wall is unreviewable, so they are grouped —
 * but the grouping is inferred from the field *codes the backend published*, never
 * from a hardcoded list of them. Nothing here states how many trades exist, how
 * many fields a trade has, or what any field means. Delete a trade from the
 * backend package and four groups render; add a sixth and six render.
 *
 * This is the semantic grouping CI-4 established for the learner form, reproduced
 * from the same source of truth rather than imported from the Academy repository —
 * so there is no runtime dependency between the two applications.
 *
 * ## The rules
 *
 * - `tradeN-*` → trade group N, ordered numerically.
 * - `summary-*` → the summary group, last.
 * - anything else → a leading "general" group (today: `confirm-demo-only`).
 *
 * An unrecognised prefix is never dropped. It lands in the general group, because
 * silently hiding a field a mentor is meant to review is the one failure mode this
 * must not have.
 */
import type { ReportFieldDefinition, ReportFieldValue } from "@/data/contracts/api/report-review";

export type FieldGroupKind = "general" | "trade" | "summary";

export interface GroupedField {
  definition: ReportFieldDefinition;
  /** Absent when the learner submitted no value for this field. */
  value: ReportFieldValue | undefined;
  /** True when the definition is optional and no value was submitted. */
  missing: boolean;
}

export interface FieldGroup {
  kind: FieldGroupKind;
  /** Stable identifier, e.g. `trade-1`, `summary`, `general`. */
  key: string;
  /** Present only for `kind: "trade"`. */
  tradeNumber?: number;
  fields: GroupedField[];
}

const TRADE_PREFIX = /^trade(\d+)-/;
const SUMMARY_PREFIX = /^summary-/;

/**
 * Group the definitions and pair each with its submitted value.
 *
 * Field order *within* a group is the backend's `fields` order, which is the
 * authored `sortOrder`. Group order is general → trades ascending → summary.
 */
export function groupReportFields(
  definitions: readonly ReportFieldDefinition[],
  values: Readonly<Record<string, ReportFieldValue>>,
): FieldGroup[] {
  const general: GroupedField[] = [];
  const summary: GroupedField[] = [];
  const trades = new Map<number, GroupedField[]>();

  for (const definition of definitions) {
    const hasValue = Object.prototype.hasOwnProperty.call(values, definition.code);
    const entry: GroupedField = {
      definition,
      value: hasValue ? values[definition.code] : undefined,
      missing: !hasValue,
    };

    const tradeMatch = TRADE_PREFIX.exec(definition.code);
    if (tradeMatch) {
      const number = Number(tradeMatch[1]);
      // A non-finite or absurd trade index would be a malformed code, not a
      // trade — send it to `general` rather than creating a nonsense group.
      if (Number.isInteger(number) && number > 0 && number < 1_000) {
        const bucket = trades.get(number) ?? [];
        bucket.push(entry);
        trades.set(number, bucket);
        continue;
      }
    }

    if (SUMMARY_PREFIX.test(definition.code)) {
      summary.push(entry);
      continue;
    }

    general.push(entry);
  }

  const groups: FieldGroup[] = [];
  if (general.length > 0) groups.push({ kind: "general", key: "general", fields: general });
  for (const number of [...trades.keys()].sort((a, b) => a - b)) {
    groups.push({
      kind: "trade",
      key: `trade-${number}`,
      tradeNumber: number,
      fields: trades.get(number)!,
    });
  }
  if (summary.length > 0) groups.push({ kind: "summary", key: "summary", fields: summary });
  return groups;
}

/** How many trade groups the definition produced. Used for the detail heading. */
export function tradeGroupCount(groups: readonly FieldGroup[]): number {
  return groups.filter((group) => group.kind === "trade").length;
}

/* ------------------------------------------------------- value presentation */

export type PresentedValue =
  | { kind: "boolean"; value: boolean }
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  /**
   * A choice value shown as its stable code.
   *
   * The reviewer DTO carries a label for the *field* but no catalog of localized
   * labels for its options, so `"up"` can only be shown as `up`. It is marked as
   * a code in the UI so nobody mistakes it for prose, and CRM does **not** invent
   * a translation — hardcoding one here would make the CRM an unauthorized source
   * of product copy. Recorded as a Backend follow-up.
   */
  | { kind: "code"; value: string }
  | { kind: "codeList"; values: string[] }
  /** Optional field the learner left unanswered. Rendered as "not applicable". */
  | { kind: "absent" }
  /**
   * A value whose runtime shape contradicts its declared type, or a declared type
   * this renderer does not know. Surfaced as an explicit warning rather than
   * coerced — a silently stringified value is a value a mentor might review as if
   * it were correct.
   */
  | { kind: "unsupported"; declaredType: string; rawPreview: string };

const MAX_PREVIEW = 120;

function preview(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  return text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}…` : text;
}

/**
 * Decide how one field's value should be presented, from its declared type.
 *
 * Every branch validates the runtime shape against the declared type. A
 * `boolean` field carrying a string is `unsupported`, not `"true"`.
 */
export function presentValue(field: GroupedField): PresentedValue {
  const { definition, value } = field;

  if (value === undefined || value === null) {
    return definition.required
      ? { kind: "unsupported", declaredType: definition.type, rawPreview: "missing required value" }
      : { kind: "absent" };
  }

  switch (definition.type) {
    case "boolean":
      return typeof value === "boolean"
        ? { kind: "boolean", value }
        : { kind: "unsupported", declaredType: definition.type, rawPreview: preview(value) };

    case "short_text":
    case "long_text":
    case "url":
      return typeof value === "string"
        ? { kind: "text", value }
        : { kind: "unsupported", declaredType: definition.type, rawPreview: preview(value) };

    case "integer":
    case "decimal":
      return typeof value === "number"
        ? { kind: "number", value }
        : { kind: "unsupported", declaredType: definition.type, rawPreview: preview(value) };

    case "single_choice":
      return typeof value === "string"
        ? { kind: "code", value }
        : { kind: "unsupported", declaredType: definition.type, rawPreview: preview(value) };

    case "multi_choice":
      return Array.isArray(value) && value.every((item) => typeof item === "string")
        ? { kind: "codeList", values: value }
        : { kind: "unsupported", declaredType: definition.type, rawPreview: preview(value) };

    default:
      // A field type the backend introduced and this renderer does not know.
      // Visible and safe, never guessed.
      return { kind: "unsupported", declaredType: definition.type, rawPreview: preview(value) };
  }
}

/**
 * Whether a field is a conditional deviation note.
 *
 * Used only to give those fields explicit "not applicable" semantics when the
 * learner followed the plan, instead of showing a blank row. Derived from the
 * published code suffix; the `requiredWhen` rule itself remains the backend's.
 */
export function isConditionalNote(definition: ReportFieldDefinition): boolean {
  return definition.code.endsWith("-deviation-note");
}
