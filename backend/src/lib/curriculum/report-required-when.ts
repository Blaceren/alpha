/**
 * RC-1 — bounded, declarative conditional requiredness for report fields.
 *
 * A report field may be required only when ANOTHER field in the SAME report
 * definition satisfies a bounded `equals` condition. This is deliberately NOT an
 * expression language:
 *
 *   - the only operator is `equals`;
 *   - the comparison value is a single typed scalar (boolean | string | number | null);
 *   - the controller must be another field of the same report definition, and it
 *     must appear earlier (lower sortOrder) so the condition is evaluable in one
 *     deterministic pass over submitted values;
 *   - there is no eval / Function / JSONLogic / regex / nested tree / cross-report
 *     reference / computed value / network lookup / time dependency.
 *
 * The public/package semantic shape is exactly:
 *
 *   requiredWhen?: { fieldCode: string; operator: "equals"; value: boolean | string | number | null }
 *
 * Requiredness sources are mutually exclusive: a field is either statically
 * required (`required: true`, `requiredWhen: null`), optional (`required: false`,
 * `requiredWhen: null`), or conditionally required (`required: false`,
 * `requiredWhen != null`). `required: true` combined with `requiredWhen` is
 * rejected — a single source of requiredness must be explicit.
 */
import { z } from "zod";

export const REQUIRED_WHEN_OPERATORS = ["equals"] as const;
export type RequiredWhenOperator = (typeof REQUIRED_WHEN_OPERATORS)[number];

/**
 * Controller reference grammar. Matches the package report-field stable-key
 * grammar so a condition can reference any field code a package can carry.
 */
const REQUIRED_WHEN_FIELD_CODE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

/** Keys that must never be honoured as a controller reference. */
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Strict structural schema. `z.strictObject` rejects unknown keys (including
 * prototype-pollution keys), the operator is a closed enum, and the value is a
 * single scalar. `value` is required (may be explicit null) so equality always
 * has an explicit target.
 */
export const requiredWhenSchema = z
  .strictObject({
    fieldCode: z.string().trim().min(1).max(64).regex(REQUIRED_WHEN_FIELD_CODE),
    operator: z.enum(REQUIRED_WHEN_OPERATORS),
    value: z.union([z.boolean(), z.string().trim().max(2_000), z.number(), z.null()]),
  })
  .superRefine((rule, ctx) => {
    if (typeof rule.value === "number" && !Number.isFinite(rule.value)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "numeric condition value must be finite" });
    }
    if (DANGEROUS_KEYS.has(rule.fieldCode)) {
      ctx.addIssue({ code: "custom", path: ["fieldCode"], message: "controller field code is not allowed" });
    }
  });

export type RequiredWhen = z.infer<typeof requiredWhenSchema>;

export type RequiredWhenParse = { ok: true; rule: RequiredWhen | null } | { ok: false };

/**
 * Parse a persisted or authored `requiredWhen`. Fails CLOSED: null/undefined is a
 * valid "no condition", anything else that does not match the strict schema is a
 * hard parse failure the caller must treat as corrupt (never silently dropped).
 */
export function parseRequiredWhen(value: unknown): RequiredWhenParse {
  if (value === null || value === undefined) return { ok: true, rule: null };
  const parsed = requiredWhenSchema.safeParse(value);
  return parsed.success ? { ok: true, rule: parsed.data } : { ok: false };
}

/** Minimal field description needed to validate a condition against siblings. */
export type RequiredWhenFieldRef = {
  stableKey: string;
  type: string;
  sortOrder: number;
  required: boolean;
  choiceCodes: readonly string[] | null;
};

export type RequiredWhenIssue = { code: string; message: string };

function comparisonCompatible(controller: RequiredWhenFieldRef, value: RequiredWhen["value"]): boolean {
  switch (controller.type) {
    case "boolean":
      return typeof value === "boolean";
    case "short_text":
    case "long_text":
    case "url":
      return value === null || typeof value === "string";
    case "integer":
      return value === null || (typeof value === "number" && Number.isInteger(value) && Number.isFinite(value));
    case "single_choice":
      return (
        value === null ||
        (typeof value === "string" && controller.choiceCodes !== null && controller.choiceCodes.includes(value))
      );
    default:
      // multi_choice and any unknown controller type cannot be compared with a
      // scalar `equals`, so they may not be a controller.
      return false;
  }
}

/**
 * Validate one condition against the fields of the SAME report definition.
 * Returns the first issue, or null when the condition is well-formed and
 * deterministically evaluable.
 */
export function validateRequiredWhen(
  rule: RequiredWhen,
  self: RequiredWhenFieldRef,
  fieldsByCode: ReadonlyMap<string, RequiredWhenFieldRef>,
): RequiredWhenIssue | null {
  if (self.required) {
    return { code: "REQUIRED_WHEN_CONFLICT", message: "a statically required field must not also declare requiredWhen" };
  }
  if (rule.operator !== "equals") {
    return { code: "REQUIRED_WHEN_OPERATOR", message: "unsupported requiredWhen operator" };
  }
  if (rule.fieldCode === self.stableKey) {
    return { code: "REQUIRED_WHEN_SELF", message: "requiredWhen must not reference its own field" };
  }
  const controller = fieldsByCode.get(rule.fieldCode);
  if (!controller) {
    return { code: "REQUIRED_WHEN_CONTROLLER_MISSING", message: "requiredWhen controller is not a field of this report definition" };
  }
  if (controller.sortOrder >= self.sortOrder) {
    return { code: "REQUIRED_WHEN_ORDER", message: "requiredWhen controller field must precede the dependent field" };
  }
  if (!comparisonCompatible(controller, rule.value)) {
    return { code: "REQUIRED_WHEN_TYPE", message: "requiredWhen value is incompatible with the controller field type" };
  }
  return null;
}

/** Strict, coercion-free equality for the `equals` operator. */
function typedEquals(actual: unknown, expected: RequiredWhen["value"]): boolean {
  if (expected === null) return actual === null;
  if (typeof actual !== typeof expected) return false;
  if (typeof actual === "number") return Number.isFinite(actual) && actual === expected;
  // boolean or string — strict identity, never coerced ("false" !== false, "0" !== 0).
  return actual === expected;
}

/**
 * Evaluate whether a condition is ACTIVE against already-normalized submitted
 * values. A missing controller value yields `false` (never coerced into the
 * comparison target): the dependent field is simply not made required by the
 * condition. The controller's own required validation is what fails a genuinely
 * missing required controller.
 */
export function isRequiredWhenActive(rule: RequiredWhen, submittedValues: Record<string, unknown>): boolean {
  const key = rule.fieldCode;
  if (DANGEROUS_KEYS.has(key) || !Object.prototype.hasOwnProperty.call(submittedValues, key)) return false;
  return typedEquals(submittedValues[key], rule.value);
}
