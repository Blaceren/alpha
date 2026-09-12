/**
 * Position-risk calculation model (Phase D4-C) — a PURE educational estimate.
 *
 * This module intentionally has no React, no DOM, no storage, no fetch and no
 * environment access. It never throws for normal user input and never returns
 * `NaN` or `Infinity`: malformed or partial input resolves to an explicit
 * `incomplete` / `invalid` state, and only a fully valid set of four numbers
 * yields a `valid` result with a long/short direction.
 *
 * "Расчётный капитал" is a TEMPORARY calculation input — never a connected
 * balance, never fetched, never persisted, never written to progression. Nothing
 * here is an execution engine or a broker feature (DD-303 privacy line).
 */

/** The four manual inputs, always carried as raw controlled strings. */
export interface RiskInput {
  /** Расчётный капитал — a hypothetical figure, never a real balance. */
  capital: string;
  /** Риск на сделку, % */
  riskPercent: string;
  /** Цена входа */
  entryPrice: string;
  /** Стоп-цена */
  stopPrice: string;
}

export type RiskField = "capital" | "riskPercent" | "entryPrice" | "stopPrice";

/**
 * Per-field validation state.
 *  - `null`     — the field is fine (or, for `incomplete`, simply not filled yet
 *                 with no format problem);
 *  - `empty`    — nothing entered (contributes to `incomplete`, not an error);
 *  - `format`   — non-empty but malformed syntax;
 *  - `nonPositive` — parsed but ≤ 0;
 *  - `over100`  — risk percent above 100;
 *  - `equal`    — entry and stop are equal (attached to `stopPrice`).
 */
export type RiskFieldError = "empty" | "format" | "nonPositive" | "over100" | "equal";

export interface RiskFieldStates {
  capital: RiskFieldError | null;
  riskPercent: RiskFieldError | null;
  entryPrice: RiskFieldError | null;
  stopPrice: RiskFieldError | null;
}

/** A whole-result problem not tied to one field (e.g. a numeric overflow). */
export type RiskGeneralError = "range";

export type RiskDirection = "long" | "short";

export type RiskCalculationResult =
  | { status: "incomplete"; fields: RiskFieldStates }
  | { status: "invalid"; fields: RiskFieldStates; general: RiskGeneralError | null }
  | {
      status: "valid";
      direction: RiskDirection;
      riskAmount: number;
      stopDistance: number;
      stopDistancePercent: number;
      positionUnits: number;
      positionNotional: number;
    };

/**
 * A safe upper bound on the raw string length accepted for any one field. Long
 * enough for any realistic value, short enough to bound work and keep results
 * displayable. Enforced BOTH here and by the input `maxLength` in the UI.
 */
export const MAX_INPUT_LENGTH = 18;

/**
 * The largest magnitude a computed core value may reach and still be shown as an
 * honest, non-scientific number. Anything beyond this fails closed as `invalid`
 * rather than rendering a misleading rounded infinity-scale figure.
 */
const MAX_DISPLAYABLE = 1e15;

export interface ParseOk {
  ok: true;
  value: number;
}
export interface ParseErr {
  ok: false;
}
export type ParseResult = ParseOk | ParseErr;

/**
 * Parse ONE controlled decimal string under the strict D4-C syntax.
 *
 * Accepted: surrounding whitespace, digits, an optional single `.` OR `,`
 * separator with at least one digit on each side (`1000`, `1000.5`, `1000,5`,
 * `0.25`, `0,25`).
 *
 * Rejected: sign (`+`/`-`), exponent, internal spaces, thousands separators,
 * multiple separators, a bare separator, mixed comma and period, and anything
 * non-finite. Empty / whitespace-only is a non-error "not filled" signal handled
 * by the caller; here it simply fails to parse.
 */
export function parseDecimal(raw: string): ParseResult {
  if (typeof raw !== "string") return { ok: false };
  if (raw.length > MAX_INPUT_LENGTH) return { ok: false };
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false };
  // One optional separator (comma OR period), at least one digit on each side.
  // This single anchor rejects signs, exponents, internal spaces, thousands
  // separators, multiple/mixed separators and bare separators in one pass.
  if (!/^\d+(?:[.,]\d+)?$/.test(trimmed)) return { ok: false };
  const value = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(value)) return { ok: false };
  return { ok: true, value };
}

interface FieldParse {
  error: RiskFieldError | null;
  /** Present only when the field parsed to a finite positive number. */
  value: number | null;
}

/** Parse one numeric field, applying its own positivity / range rule. */
function parseField(raw: string, opts: { max?: number } = {}): FieldParse {
  if (raw.trim() === "") return { error: "empty", value: null };
  const parsed = parseDecimal(raw);
  if (!parsed.ok) return { error: "format", value: null };
  if (parsed.value <= 0) return { error: "nonPositive", value: null };
  if (opts.max !== undefined && parsed.value > opts.max) return { error: "over100", value: null };
  return { error: null, value: parsed.value };
}

const EMPTY_FIELDS: RiskFieldStates = {
  capital: null,
  riskPercent: null,
  entryPrice: null,
  stopPrice: null,
};

/**
 * Turn the four raw strings into a discriminated result. Order of precedence:
 * a malformed / out-of-range FILLED field makes the whole thing `invalid`
 * (with field-specific errors); otherwise any empty field keeps it `incomplete`;
 * only a complete, in-range, distinct entry/stop set is `valid`.
 */
export function calculateRisk(input: RiskInput): RiskCalculationResult {
  const capital = parseField(input.capital);
  const riskPercent = parseField(input.riskPercent, { max: 100 });
  const entryPrice = parseField(input.entryPrice);
  const stopPrice = parseField(input.stopPrice);

  const fields: RiskFieldStates = {
    capital: capital.error,
    riskPercent: riskPercent.error,
    entryPrice: entryPrice.error,
    stopPrice: stopPrice.error,
  };

  // Equal entry/stop is only meaningful once BOTH parsed as positive numbers.
  if (
    entryPrice.value !== null &&
    stopPrice.value !== null &&
    entryPrice.value === stopPrice.value
  ) {
    fields.stopPrice = "equal";
  }

  const hasHardError = (Object.values(fields) as (RiskFieldError | null)[]).some(
    (e) => e !== null && e !== "empty",
  );
  const hasEmpty = (Object.values(fields) as (RiskFieldError | null)[]).some(
    (e) => e === "empty",
  );

  if (hasHardError) return { status: "invalid", fields, general: null };
  if (hasEmpty) return { status: "incomplete", fields };

  // All four are finite positives and entry !== stop.
  const capitalV = capital.value!;
  const riskV = riskPercent.value!;
  const entryV = entryPrice.value!;
  const stopV = stopPrice.value!;

  const riskAmount = (capitalV * riskV) / 100;
  const stopDistance = Math.abs(entryV - stopV);
  const stopDistancePercent = (stopDistance / entryV) * 100;
  const positionUnits = riskAmount / stopDistance;
  const positionNotional = positionUnits * entryV;
  const direction: RiskDirection = stopV < entryV ? "long" : "short";

  const core = [riskAmount, stopDistance, stopDistancePercent, positionUnits, positionNotional];
  // Fail closed on any non-finite or over-scale value — never render a
  // misleading infinity-scale figure.
  if (core.some((n) => !Number.isFinite(n) || Math.abs(n) > MAX_DISPLAYABLE)) {
    return { status: "invalid", fields: EMPTY_FIELDS, general: "range" };
  }

  return {
    status: "valid",
    direction,
    riskAmount,
    stopDistance,
    stopDistancePercent,
    positionUnits,
    positionNotional,
  };
}
