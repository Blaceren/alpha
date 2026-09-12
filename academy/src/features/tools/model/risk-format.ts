/**
 * Deterministic Russian-locale number formatting for the Risk Calculator
 * (Phase D4-C). Pure — no React, no DOM.
 *
 * Rules (product contract §10):
 *  - RU interface locale (comma decimal separator);
 *  - never scientific notation in normal visible output;
 *  - meaningless trailing zeros stripped;
 *  - useful fractional position sizes preserved (up to 8 digits);
 *  - never `-0`, never `NaN`, never `Infinity`;
 *  - NO currency symbol / unit is ever prepended (no account or asset currency
 *    is selected — DD-303).
 *
 * Grouping separators are disabled so the visible output stays byte-stable
 * across environments and screenshots (a `ru-RU` group separator is a
 * non-breaking space, which is brittle in tests).
 */

/** Visible fractional precision per value class (product contract §10). */
export const PRECISION = {
  percent: 4,
  units: 8,
  price: 8,
  amount: 8,
} as const;

/**
 * Format one finite number for display. `-0` and `0` both render as `"0"`;
 * non-finite input degrades to an em dash rather than `NaN`/`Infinity`.
 */
export function formatNumber(value: number, maxFractionDigits: number): string {
  if (!Number.isFinite(value)) return "—";
  // `value === 0` is true for -0 as well, which kills the "-0" display.
  const safe = value === 0 ? 0 : value;
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: maxFractionDigits,
    useGrouping: false,
  }).format(safe);
}

/** A stop-distance percentage, formatted with a trailing percent sign. */
export function formatPercent(value: number): string {
  return `${formatNumber(value, PRECISION.percent)}%`;
}
