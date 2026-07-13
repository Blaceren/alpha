/**
 * Future backend contract (SHAPE ONLY — no implementation, no network).
 * Phase D1A uses synthetic data that satisfies this contract. When the real
 * backend arrives, an adapter maps its response to DashboardState.
 *
 * Financial-privacy invariant (DD-020…DD-024): this contract intentionally has
 * NO field for user balance / deposits / withdrawals / "remaining $X". The only
 * money value ever surfaced is the checkpoint *target*.
 */

import type { DashboardState } from "@/domain/progression";

export interface DashboardProvider {
  /** Returns the current learner's dashboard state. */
  getDashboardState(): Promise<DashboardState> | DashboardState;
}

/** Marker for the provider currently in use (synthetic in D1A). */
export type DashboardProviderKind = "synthetic" | "backend";
