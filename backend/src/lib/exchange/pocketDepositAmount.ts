/**
 * AFD-4 — the exact decimal contract for a Pocket first-deposit amount.
 *
 * WHY NOT `Number()`. The legacy route parsed `sum` with
 * `Number(value.replace(",", "."))`, which is IEEE-754 binary floating point.
 * That representation cannot hold `282.70` exactly, accepts `1e2`, `Infinity`,
 * ` 12 ` and `0x10`, and silently truncates precision an operator would later be
 * asked to reconcile against a provider statement. A deposit is money that
 * somebody is paid a commission on, so the canonical value here is a STRING
 * validated character by character and never round-tripped through a float.
 *
 * WHAT THIS IS NOT. This is a first-deposit amount: one immutable number a
 * provider reported once. It is not a balance, not a running total and not
 * something later events add to. Nothing in this module sums, subtracts or
 * compares magnitudes, because AFD-4 has no arithmetic to do.
 */

/**
 * Bounded precision. Two fractional digits is the Pocket contract as observed
 * (`282.70`) and matches the repository's only other money-shaped provider
 * value. A third digit is refused rather than rounded: rounding money without
 * being told to is how a reconciliation dispute starts.
 */
export const POCKET_AMOUNT_FRACTION_DIGITS = 2;

/**
 * Bounded magnitude. Twelve integer digits is far above any plausible retail
 * first deposit and far below anything that could stress the storage or a
 * downstream reader, so an absurd value is a rejection rather than a row.
 */
export const POCKET_AMOUNT_MAX_INTEGER_DIGITS = 12;

/** Belt and braces: a total length bound, checked before the pattern. */
export const POCKET_AMOUNT_MAX_LENGTH =
  POCKET_AMOUNT_MAX_INTEGER_DIGITS + 1 + POCKET_AMOUNT_FRACTION_DIGITS;

/**
 * The ONLY accepted spelling.
 *
 * Anchored at both ends, so nothing may precede or follow the number. No sign,
 * no exponent, no thousands separator, no comma-as-decimal, no whitespace, no
 * currency symbol and no leading zeros other than the single `0` that may
 * introduce a sub-unit amount. `0.50` is a legal fifty-cent deposit; `01.00`,
 * `+1`, `-1`, `1e2`, `1,20` and `1.234` are not.
 */
const POCKET_AMOUNT = new RegExp(
  `^(?:0|[1-9][0-9]{0,${POCKET_AMOUNT_MAX_INTEGER_DIGITS - 1}})(?:\\.[0-9]{1,${POCKET_AMOUNT_FRACTION_DIGITS}})?$`,
);

export type PocketAmountRejection =
  | "empty"
  | "too_long"
  | "malformed"
  | "not_positive";

export type PocketAmountResult =
  | { readonly ok: true; readonly normalized: string }
  | { readonly ok: false; readonly reason: PocketAmountRejection };

/**
 * Parse and canonically normalise a provider-reported deposit amount.
 *
 * NORMALISATION IS PADDING, NEVER ROUNDING. `282` becomes `282.00` and `282.7`
 * becomes `282.70` — the value is unchanged and only its written form is made
 * canonical, so that two deliveries of the same deposit compare equal as
 * strings. An input that would need rounding to fit the precision is rejected
 * by the pattern above and never reaches this step.
 *
 * ZERO IS NOT A DEPOSIT. `0` and `0.00` are well-formed numbers and are still
 * refused: a first deposit of nothing is either a provider error or a probe,
 * and storing it would create a canonical first-deposit event that can never be
 * superseded by the real one.
 */
export function parsePocketDepositAmount(raw: string | undefined | null): PocketAmountResult {
  if (raw === undefined || raw === null || raw.length === 0) {
    return { ok: false, reason: "empty" };
  }

  // Length first, so a pathological input is refused before any pattern runs.
  if (raw.length > POCKET_AMOUNT_MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }

  if (!POCKET_AMOUNT.test(raw)) {
    return { ok: false, reason: "malformed" };
  }

  const [integerPart, fractionPart = ""] = raw.split(".");
  const normalized = `${integerPart}.${fractionPart.padEnd(POCKET_AMOUNT_FRACTION_DIGITS, "0")}`;

  // Positivity is decided on the DIGITS, not on a numeric conversion, so the
  // check never inherits a float's idea of what is zero.
  if (!/[1-9]/.test(normalized)) {
    return { ok: false, reason: "not_positive" };
  }

  return { ok: true, normalized };
}

/**
 * Whether a stored value is already in canonical form.
 *
 * Used by the schema-facing tests and the reconciliation command to assert that
 * nothing ever wrote an unnormalised amount, which is what would make two
 * deliveries of one deposit compare unequal and look like a conflict.
 */
export function isCanonicalPocketAmount(value: string): boolean {
  const parsed = parsePocketDepositAmount(value);
  return parsed.ok && parsed.normalized === value;
}
