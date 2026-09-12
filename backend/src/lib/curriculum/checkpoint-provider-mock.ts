/**
 * L4VC-1 — deterministic mock balance provider. TEST-ONLY.
 *
 * It exists so every branch of the verification engine can be proven without a
 * real provider: there is no Pocket URL here, no HTTP client, no credential and
 * no network call of any kind. `verifyThreshold` is a pure switch over a case
 * name plus a comparison against the threshold the caller passed in.
 *
 * ACTIVATION IS DELIBERATELY AWKWARD
 * `resolveCheckpointProvider` will only ever select this provider when
 * `NODE_ENV !== "production"` AND the exact opt-in marker is present — the same
 * shape used by the report-attachment test backend. A production process cannot
 * reach it even if someone sets the variable, and production env validation
 * rejects the marker outright.
 *
 * WHAT IT STILL MAY NOT DO
 * Even as a test double it never returns a balance: the `real account` and
 * `demo-only account` cases are expressed as verdicts (`met` / `not_met`),
 * because a mock that returned an amount would let a leak be written and pass
 * its own tests.
 */
import type {
  CheckpointBalanceProvider,
  CheckpointProviderRequest,
  CheckpointProviderResult,
} from "./checkpoint-provider";

/**
 * The deterministic scenarios. Each maps to exactly one provider result, so a
 * test names the situation rather than constructing a payload.
 */
export type CheckpointMockCase =
  /** Real account at or above the threshold. */
  | "met"
  /** Real account below the threshold. */
  | "not_met"
  /** Real (non-demo) account above the threshold — the canonical pass. */
  | "real_account"
  /** Only a demo account exists. Demo money is never a pass, and never a balance. */
  | "demo_only"
  /** No provider account is linked to this learner. */
  | "identity_unlinked"
  /** A linked account exists but belongs to a different identity. */
  | "identity_mismatch"
  /** The account is denominated in a currency the threshold cannot be compared to. */
  | "unsupported_currency"
  /** The adapter never settles; the engine's deadline must fire. */
  | "timeout"
  | "maintenance"
  | "rate_limited"
  /** The provider answered, but from data too old to be authoritative. */
  | "stale"
  /** The provider answered with something outside the contract. */
  | "invalid_response"
  /** The adapter throws instead of returning. */
  | "throws";

export const CHECKPOINT_MOCK_CASES: readonly CheckpointMockCase[] = [
  "met",
  "not_met",
  "real_account",
  "demo_only",
  "identity_unlinked",
  "identity_mismatch",
  "unsupported_currency",
  "timeout",
  "maintenance",
  "rate_limited",
  "stale",
  "invalid_response",
  "throws",
];

export type CheckpointMockOptions = {
  /** Fixed observation time so assertions are stable. */
  readonly observedAt?: Date;
  /** Advertised back-pressure for the rate-limited case. */
  readonly retryAfterSeconds?: number;
  /**
   * Observed minor units used ONLY inside this file to decide met/not_met. It
   * is never returned, never persisted and never logged — it exists so the mock
   * performs a real comparison rather than hard-coding a verdict.
   */
  readonly observedMinorUnits?: number;
};

/** Counts calls so "exactly one provider call" is provable, not assumed. */
export type CheckpointMockProvider = CheckpointBalanceProvider & {
  readonly calls: CheckpointProviderRequest[];
  readonly callCount: () => number;
};

const DEFAULT_OBSERVED_AT = new Date("2026-07-28T00:00:00.000Z");

export function createCheckpointMockProvider(
  scenario: CheckpointMockCase,
  options: CheckpointMockOptions = {},
): CheckpointMockProvider {
  const calls: CheckpointProviderRequest[] = [];
  const observedAt = options.observedAt ?? DEFAULT_OBSERVED_AT;
  const providerRequestId = `mock-${scenario}`;

  return {
    id: "mock",
    calls,
    callCount: () => calls.length,
    async verifyThreshold(request: CheckpointProviderRequest): Promise<CheckpointProviderResult> {
      calls.push(request);

      switch (scenario) {
        case "met":
        case "real_account": {
          // A genuine comparison against the threshold the ENGINE supplied.
          // The observed value never leaves this scope.
          const observed = options.observedMinorUnits ?? request.thresholdMinorUnits;
          return observed >= request.thresholdMinorUnits
            ? { outcome: "met", providerRequestId, observedAt }
            : { outcome: "not_met", providerRequestId, observedAt };
        }
        case "not_met": {
          const observed = options.observedMinorUnits ?? request.thresholdMinorUnits - 1;
          return observed >= request.thresholdMinorUnits
            ? { outcome: "met", providerRequestId, observedAt }
            : { outcome: "not_met", providerRequestId, observedAt };
        }
        case "demo_only":
          // A demo account is not a real balance at all. It is NOT reported as a
          // smaller number — it is reported as "the threshold is not met", with
          // no hint that demo funds exist.
          return { outcome: "not_met", providerRequestId, observedAt };
        case "identity_unlinked":
          return { outcome: "identity_unlinked", providerRequestId };
        case "identity_mismatch":
          return { outcome: "identity_mismatch", providerRequestId };
        case "unsupported_currency":
          return { outcome: "unsupported_currency", providerRequestId };
        case "timeout":
          // Never settles. The engine's AbortController is what must resolve it,
          // which is exactly what the timeout test needs to prove.
          return new Promise<CheckpointProviderResult>((resolve) => {
            request.timeoutSignal.addEventListener(
              "abort",
              () => resolve({ outcome: "unavailable", reason: "provider_timeout" }),
              { once: true },
            );
          });
        case "maintenance":
          return { outcome: "unavailable", reason: "provider_maintenance", providerRequestId };
        case "rate_limited":
          return {
            outcome: "unavailable",
            reason: "provider_rate_limited",
            providerRequestId,
            retryAfterSeconds: options.retryAfterSeconds ?? 120,
          };
        case "stale":
          return { outcome: "stale", providerRequestId, observedAt };
        case "invalid_response":
          // Deliberately hostile: an unknown outcome AND a balance-shaped key.
          // The normalizer must reduce this to `invalid_provider_response` and
          // drop the extra field, which is what makes the privacy contract
          // structural rather than advisory.
          return {
            outcome: "totally-unknown-outcome",
            balanceMinorUnits: 999_999,
            accountLogin: "should-never-survive",
          } as unknown as CheckpointProviderResult;
        case "throws":
          throw new Error("mock provider failure");
      }
    },
  };
}
