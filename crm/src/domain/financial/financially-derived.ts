/**
 * Which signals explain themselves with a number derived from the exact balance.
 *
 * Extracted from the User 360 projection (Phase 1C.1) so Today can enforce the
 * SAME rule (Phase 1B3). Two surfaces each keeping their own copy of this list
 * is how a redaction silently drifts: a signal added to one list and not the
 * other would be redacted on the profile and leaked in the queue.
 *
 * `checkpoint_approaching` says "осталось N%" and the checkpoint grid is a
 * PUBLISHED constant ($100 at L10), so N% + grid reconstructs the exact balance
 * — a role limited to the "$50–99" bucket could derive "$90" by arithmetic.
 * `rapid_balance_decline` reports a drop %, which is relative but still
 * balance-derived.
 *
 * Framework-agnostic — no React/Next imports.
 */
import type { CrmRole } from "@/domain/identity/roles";
import type { SignalCode } from "@/domain/signals/signal";
import { canViewExactFinancials } from "@/domain/identity/access";

export const FINANCIALLY_DERIVED_SIGNALS: readonly SignalCode[] = [
  "checkpoint_approaching",
  "rapid_balance_decline",
];

/** True when this role must not see this signal's balance-derived explanation. */
export function redactsFinancialDerivation(role: CrmRole, code: SignalCode): boolean {
  return !canViewExactFinancials(role) && FINANCIALLY_DERIVED_SIGNALS.includes(code);
}
