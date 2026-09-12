/**
 * Pure evaluator for the Backend `requiredWhen` conditional-requiredness rule
 * (no React, fully testable). The only supported operator is `equals`, evaluated
 * with STRICT equality against the current controller value — never coerced,
 * never an executable expression, never `eval`/JSONLogic.
 *
 * This is CLIENT-SIDE GUIDANCE ONLY. The Backend re-validates every submission
 * and remains the final authority; a mismatch here can never weaken the server.
 */
import type { ReportRequiredWhen } from "@/lib/report/types";

/**
 * True when the rule's controller field currently equals the rule's value, i.e.
 * the dependent field is conditionally required right now.
 *
 * Strict semantics: a boolean rule value of `false` is active only when the
 * controller value is exactly the boolean `false` — not `0`, not `"false"`, not
 * `undefined`. A missing/undefined controller is never active.
 */
export function isRequiredWhenActive(
  rule: ReportRequiredWhen,
  values: Record<string, unknown>,
): boolean {
  if (!(rule.fieldCode in values)) return false;
  const current = values[rule.fieldCode];
  if (current === undefined) return false;
  return strictEquals(current, rule.value);
}

/**
 * A field is required for submission when it is statically required OR its
 * `requiredWhen` rule is currently active.
 */
export function isFieldEffectivelyRequired(
  field: { required: boolean; requiredWhen: ReportRequiredWhen | null },
  values: Record<string, unknown>,
): boolean {
  if (field.required) return true;
  if (field.requiredWhen) return isRequiredWhenActive(field.requiredWhen, values);
  return false;
}

function strictEquals(a: unknown, b: boolean | string | number | null): boolean {
  if (b === null) return a === null;
  // Reject cross-type comparisons explicitly so `1 == true` / `"true" == true`
  // can never be treated as a match.
  if (typeof a !== typeof b) return false;
  return a === b;
}
