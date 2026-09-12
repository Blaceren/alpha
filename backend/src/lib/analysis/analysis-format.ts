/**
 * AFD-5D1 — presentation arithmetic, and the boundary it must not cross.
 *
 * WHAT IS ALLOWED HERE. Rendering an ALREADY-PUBLISHED value into the form a
 * sentence needs, and subtracting two already-published values so a change can
 * be stated. `computeRatios` and `computeCohortRates` remain the only owners of
 * a rate; nothing below divides an event count by another event count, opens a
 * database or defines a metric.
 *
 * WHY BIGINT AND NOT `Number`. The aggregates publish exact decimal STRINGS
 * (`"0.423700"`, scale 6) precisely so an operator can reconcile them against a
 * network's own report. Parsing one into a float to print a percentage would
 * reintroduce the error the analytics layer went to some trouble to remove, and
 * `0.1 + 0.2` in a sentence is a support ticket. Every function here is integer
 * arithmetic on the digits of the string.
 */

const ZERO = BigInt(0);
const TEN = BigInt(10);
const HUNDRED = BigInt(100);

/** The scale the analytics layer publishes ratios at. */
export const RATIO_SCALE = 6;

/**
 * A published decimal string as a scaled integer.
 *
 * Accepts exactly the shape the aggregates emit — an optional sign, digits, an
 * optional fractional part — and refuses anything else rather than coercing it,
 * because a value this parser did not understand would become a confident
 * number in a sentence.
 */
export function toScaled(value: string, scale: number): bigint {
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    throw new Error(`analysis: not a decimal string: "${value}"`);
  }
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = body.split(".");
  const padded = (fraction + "0".repeat(scale)).slice(0, scale);
  const magnitude = BigInt(whole + padded);
  return negative ? -magnitude : magnitude;
}

/** Render a scaled integer back to a decimal string with `digits` decimals. */
export function fromScaled(scaled: bigint, scale: number, digits: number): string {
  const negative = scaled < ZERO;
  let magnitude = negative ? -scaled : scaled;

  // Rescale by truncation, never rounding: a truncated share of a published
  // number stays below it, while rounding could print a value the aggregate
  // never contained.
  if (digits < scale) {
    magnitude = magnitude / TEN ** BigInt(scale - digits);
  } else if (digits > scale) {
    magnitude = magnitude * TEN ** BigInt(digits - scale);
  }

  const text = magnitude.toString().padStart(digits + 1, "0");
  const whole = text.slice(0, text.length - digits);
  const fraction = digits === 0 ? "" : `.${text.slice(text.length - digits)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/**
 * A published ratio as a percentage string with one decimal.
 *
 * `"0.423700"` → `"42.4"`. A shift of the decimal point, not a multiplication
 * that could overflow or round.
 */
export function ratioToPercent(ratio: string): string {
  const scaled = toScaled(ratio, RATIO_SCALE) * HUNDRED;
  return fromScaled(scaled, RATIO_SCALE, 1);
}

/** The gap between two published ratios, in percentage points, one decimal. */
export function ratioDifferencePoints(left: string, right: string): string {
  const difference = (toScaled(left, RATIO_SCALE) - toScaled(right, RATIO_SCALE)) * HUNDRED;
  return fromScaled(absolute(difference), RATIO_SCALE, 1);
}

/** True when `left` is strictly greater than `right`. */
export function ratioGreater(left: string, right: string): boolean {
  return toScaled(left, RATIO_SCALE) > toScaled(right, RATIO_SCALE);
}

/**
 * A count-to-count change as a percentage of the first value, one decimal.
 *
 * Returns null when the first value is zero: "from nothing to eighty" has no
 * percentage change, and printing one would invent a denominator. The caller
 * reports the two counts instead.
 */
export function countChangePercent(from: number, to: number): string | null {
  if (from === 0) return null;
  const delta = BigInt(Math.abs(to - from)) * HUNDRED * TEN ** BigInt(RATIO_SCALE);
  const scaled = delta / BigInt(from);
  return fromScaled(scaled, RATIO_SCALE, 1);
}

/** Share of a total, as a percentage string with one decimal, or null at zero. */
export function sharePercent(part: number, total: number): string | null {
  if (total === 0) return null;
  const scaled = (BigInt(part) * HUNDRED * TEN ** BigInt(RATIO_SCALE)) / BigInt(total);
  return fromScaled(scaled, RATIO_SCALE, 1);
}

/** Compare a percentage string against a threshold expressed the same way. */
export function percentAtLeast(value: string, threshold: string): boolean {
  return toScaled(value, RATIO_SCALE) >= toScaled(threshold, RATIO_SCALE);
}

function absolute(value: bigint): bigint {
  return value < ZERO ? -value : value;
}

/** Seconds as published by the medians, trimmed of trailing zeroes for reading. */
export function readableSeconds(seconds: string): string {
  if (!seconds.includes(".")) return seconds;
  return seconds.replace(/0+$/, "").replace(/\.$/, "");
}
