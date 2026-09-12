/**
 * AFD-5B1 — exact decimal output for analytics ratios and money.
 *
 * WHY NOT `a / b`. A conversion rate and a deposit total are numbers an operator
 * reconciles against an affiliate network's own report, and IEEE-754 cannot hold
 * `0.1` or `282.70` exactly. Serialising `1/3` as `0.3333333333333333` publishes
 * seventeen digits of which four are meaningful, and summing floats makes
 * `0.1 + 0.2` a support ticket. Everything here is integer arithmetic rendered
 * as a decimal STRING, so what is stored, summed and displayed is one value.
 *
 * NO DEPENDENCY. This is long division and column addition on `bigint`, which
 * Node has natively. A general-purpose decimal library would be a new supply
 * chain edge for two functions.
 */

/** `0n` is unavailable at this tsconfig target (ES2017), so the zero is named. */
const ZERO = BigInt(0);

/** Ratios are published to this many fractional digits. */
export const RATIO_SCALE = 6;

/** Pocket amounts are canonical two-decimal strings — see pocketDepositAmount. */
export const AMOUNT_SCALE = 2;

/**
 * An exact ratio as a decimal string, or null when the denominator is zero.
 *
 * NULL IS NOT ZERO, and the distinction is the whole point. "No qualified clicks
 * happened, so there is no click-to-registration rate" and "clicks happened and
 * none converted" are different facts; publishing 0 for the first would put a
 * 0% on a chart for a period that simply had no traffic. Every ratio field in
 * this phase is nullable for exactly this reason.
 *
 * Truncates rather than rounds, at a fixed scale, so the value never overstates
 * a rate and two readers computing it by hand get the same digits.
 */
export function exactRatio(
  numerator: number,
  denominator: number,
  scale: number = RATIO_SCALE,
): string | null {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new TypeError("exactRatio takes integer counts");
  }
  if (numerator < 0 || denominator < 0) {
    throw new RangeError("exactRatio takes non-negative counts");
  }
  if (denominator === 0) return null;
  if (numerator === 0) return renderScaled(ZERO, scale);

  const factor = BigInt(10) ** BigInt(scale);
  const scaled = (BigInt(numerator) * factor) / BigInt(denominator);
  return renderScaled(scaled, scale);
}

/** Render an integer already scaled by `10 ** scale` as a decimal string. */
function renderScaled(scaled: bigint, scale: number): string {
  const negative = scaled < ZERO;
  const digits = (negative ? -scaled : scaled).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  const rendered = scale === 0 ? whole : `${whole}.${fraction}`;
  return negative ? `-${rendered}` : rendered;
}

const CANONICAL_AMOUNT = /^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/;

/**
 * A canonical two-decimal amount as integer minor units, or a refusal.
 *
 * `"282.70"` becomes `28270n`, so no float ever sees the value. A non-canonical
 * input is a REFUSAL rather than a coercion: every amount this reads was written
 * by `parsePocketDepositAmount`, so a different shape means an assumption has
 * broken, and the honest answer is to say so rather than guess what `"282.7"`
 * was supposed to mean.
 */
export function amountToMinorUnits(amount: string): bigint {
  if (!CANONICAL_AMOUNT.test(amount)) {
    throw new RangeError("non-canonical amount reached the analytics sum");
  }
  return BigInt(amount.replace(".", ""));
}

/**
 * Render integer minor units back to a canonical amount string.
 *
 * This is the ONE place a summed total becomes text, whether the sum was
 * accumulated here or by SQLite's integer `SUM`. Both paths therefore produce
 * identical output by construction rather than by two implementations agreeing.
 */
export function renderMinorUnits(minorUnits: bigint): string {
  return renderScaled(minorUnits, AMOUNT_SCALE);
}

/** Sum canonical two-decimal amount strings exactly. */
export function sumCanonicalAmounts(amounts: readonly string[]): string {
  let minorUnits = ZERO;
  for (const amount of amounts) minorUnits += amountToMinorUnits(amount);
  return renderMinorUnits(minorUnits);
}
