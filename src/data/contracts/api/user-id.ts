/**
 * Learner id validation, mirroring the accepted backend public contract
 * (alfa-trade-academy-v2 `src/lib/crm/user-detail.ts`).
 *
 * The backend owns authoritative validation. This exists so the CRM can refuse
 * an obviously malformed route segment *before* spending a request on it, and
 * so `/users/mock_user_1` renders a local, honest state instead of a spinner
 * followed by a backend 400.
 *
 * The id stays a STRING throughout. It is never parsed into a number for
 * identity — `Number()` is used only for the range comparison, and the original
 * canonical string is what travels onward.
 */

/** Prisma/SQLite `Int` upper bound, matching the backend. */
export const PRISMA_INT_MAX = 2_147_483_647;

/** Canonical positive decimal: no sign, no leading zero, no dot, no exponent. */
const USER_ID_PATTERN = /^[1-9][0-9]{0,9}$/;

/**
 * True when `raw` is a canonical learner id the backend could accept.
 *
 * Deliberately not `parseInt`: that would accept "12abc" and "1.9" by reading a
 * numeric prefix, which is exactly the permissiveness this guard exists to
 * avoid.
 */
export function isValidCrmUserId(raw: string): boolean {
  if (!USER_ID_PATTERN.test(raw)) return false;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= PRISMA_INT_MAX;
}
