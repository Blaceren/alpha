/**
 * L4VC-1 — the provider-neutral seam for financial-checkpoint verification.
 *
 * WHAT THIS FILE IS
 * A balance provider is asked ONE question: "does this learner meet the
 * configured threshold?" It answers with a verdict, never with a measurement.
 * The curriculum domain therefore never receives, stores, returns or logs a
 * balance — not because reviewers remember to strip it, but because there is no
 * field in this contract a balance could occupy.
 *
 * WHY THE COMPARISON LIVES INSIDE THE ADAPTER
 * The threshold (currency + minor units) is passed IN so the adapter can do the
 * comparison itself against whatever shape the real API returns. If the core did
 * the comparison it would need the observed amount, and the privacy contract
 * would depend on discipline rather than on structure.
 *
 * WHAT IS DELIBERATELY ABSENT
 * No HTTP client. No URL. No credential. No token. No account identifier. No
 * `unknown`/`Json` escape hatch. This phase ships the seam and two fail-closed
 * providers; the real Pocket adapter is a later, separate act
 * (docs/POCKET_ADAPTER_HANDOFF.md).
 */

/** The only threshold currency this phase supports. */
export type CheckpointThresholdCurrency = "USD";

/**
 * Everything an adapter is allowed to know about the learner and the gate.
 *
 * `learnerId` / `enrollmentId` are internal platform integers, not provider
 * account identity: binding a platform learner to a provider account is the
 * adapter's own job and is listed as an open input in the handoff.
 */
export type CheckpointProviderRequest = {
  readonly learnerId: number;
  readonly enrollmentId: number;
  readonly levelDefinitionId: number;
  readonly integrationCode: string;
  readonly thresholdCurrency: CheckpointThresholdCurrency;
  /** Integer minor units (cents). $50.00 is 5000. Never a float. */
  readonly thresholdMinorUnits: number;
  /** Learner-supplied idempotency identity for this attempt. */
  readonly requestId: string;
  /** Bounded deadline. An adapter MUST honour it and MUST NOT retry internally. */
  readonly timeoutSignal: AbortSignal;
};

/** Why verification could not be performed. Operational only — never financial. */
export type CheckpointProviderUnavailableReason =
  | "provider_disabled"
  | "provider_unconfigured"
  | "provider_timeout"
  | "provider_maintenance"
  | "provider_rate_limited";

export const CHECKPOINT_PROVIDER_UNAVAILABLE_REASONS: readonly CheckpointProviderUnavailableReason[] =
  [
    "provider_disabled",
    "provider_unconfigured",
    "provider_timeout",
    "provider_maintenance",
    "provider_rate_limited",
  ];

/**
 * The complete set of provider metadata the platform accepts.
 *
 * `providerRequestId` is a correlation handle for support, `observedAt` is a
 * freshness timestamp, `retryAfterSeconds` is back-pressure. None of the three
 * can carry a monetary value, and nothing else is accepted.
 */
export type CheckpointProviderMetadata = {
  readonly providerRequestId?: string | null;
  readonly observedAt?: Date | null;
  readonly retryAfterSeconds?: number | null;
};

/**
 * The verdict vocabulary. `met` / `not_met` are the only two members that say
 * anything about the learner's money, and they say the least possible: whether
 * a threshold the platform already knows was reached.
 *
 * `stale` is separate from `not_met` on purpose — "the number I have is too old
 * to answer with" is not "you have not got there". `invalid_provider_response`
 * is likewise separate from `unavailable`: a provider that answered with
 * nonsense is a different operational fact from one that did not answer.
 */
export type CheckpointProviderOutcomeKind =
  | "met"
  | "not_met"
  | "identity_unlinked"
  | "identity_mismatch"
  | "unsupported_currency"
  | "unavailable"
  | "stale"
  | "invalid_provider_response";

export type CheckpointProviderResult =
  | ({ readonly outcome: Exclude<CheckpointProviderOutcomeKind, "unavailable"> } & CheckpointProviderMetadata)
  | ({
      readonly outcome: "unavailable";
      readonly reason: CheckpointProviderUnavailableReason;
    } & CheckpointProviderMetadata);

/**
 * The seam itself.
 *
 * A real adapter implements exactly this. Replacing the disabled provider with
 * a Pocket adapter must not change the domain engine, the persistence rules,
 * the API contract or the Academy — that substitutability is the whole point of
 * the phase.
 */
export type CheckpointBalanceProvider = {
  /** Stable, non-secret identity for diagnostics (e.g. "disabled", "mock"). */
  readonly id: string;
  verifyThreshold(
    request: CheckpointProviderRequest,
  ): Promise<CheckpointProviderResult>;
};

/* ------------------------------------------------------------------------ */
/* Fail-closed providers                                                     */
/* ------------------------------------------------------------------------ */

/**
 * The provider used when the provider capability flag is off.
 *
 * Answers `provider_disabled` without looking at the request. It exists as a
 * real object rather than as an `if` in the engine so "no provider" is a
 * substitutable, testable implementation of the same interface.
 */
export const disabledCheckpointProvider: CheckpointBalanceProvider = {
  id: "disabled",
  async verifyThreshold() {
    return { outcome: "unavailable", reason: "provider_disabled" };
  },
};

/**
 * The provider used when the capability flag is ON but no adapter is wired.
 *
 * This is the shipped state of the platform: the flag is a permission, not an
 * implementation. Turning it on without an adapter must never produce a verdict
 * about a learner's money.
 */
export const unconfiguredCheckpointProvider: CheckpointBalanceProvider = {
  id: "unconfigured",
  async verifyThreshold() {
    return { outcome: "unavailable", reason: "provider_unconfigured" };
  },
};

/* ------------------------------------------------------------------------ */
/* Result normalisation — the structural privacy boundary                    */
/* ------------------------------------------------------------------------ */

const OUTCOME_KINDS = new Set<string>([
  "met",
  "not_met",
  "identity_unlinked",
  "identity_mismatch",
  "unsupported_currency",
  "unavailable",
  "stale",
  "invalid_provider_response",
]);

const UNAVAILABLE_REASONS = new Set<string>(CHECKPOINT_PROVIDER_UNAVAILABLE_REASONS);

/** Bounded correlation handle. Long enough for a UUID, short enough to store. */
const PROVIDER_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Upper bound on advertised back-pressure (1 hour). */
const MAX_RETRY_AFTER_SECONDS = 3_600;

/**
 * Reduce whatever an adapter returned to a value the core is willing to hold.
 *
 * This is the enforcement point for the privacy contract. An adapter that
 * returned `{ outcome: "met", balanceMinorUnits: 7350 }` does not leak: the
 * extra key never survives this function, because the result is REBUILT from an
 * allow-list rather than spread or passed through. A structurally invalid
 * result collapses to `invalid_provider_response` — a typed, non-financial
 * outcome — instead of throwing an error whose message might quote the payload.
 */
export function normalizeCheckpointProviderResult(
  raw: unknown,
): CheckpointProviderResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { outcome: "invalid_provider_response" };
  }
  const value = raw as Record<string, unknown>;
  const outcome = value.outcome;
  if (typeof outcome !== "string" || !OUTCOME_KINDS.has(outcome)) {
    return { outcome: "invalid_provider_response" };
  }

  const providerRequestId =
    typeof value.providerRequestId === "string" &&
    PROVIDER_REQUEST_ID.test(value.providerRequestId)
      ? value.providerRequestId
      : null;

  const observedAt =
    value.observedAt instanceof Date && !Number.isNaN(value.observedAt.getTime())
      ? new Date(value.observedAt.getTime())
      : null;

  const rawRetry = value.retryAfterSeconds;
  const retryAfterSeconds =
    typeof rawRetry === "number" &&
    Number.isSafeInteger(rawRetry) &&
    rawRetry > 0 &&
    rawRetry <= MAX_RETRY_AFTER_SECONDS
      ? rawRetry
      : null;

  const metadata: CheckpointProviderMetadata = {
    providerRequestId,
    observedAt,
    retryAfterSeconds,
  };

  if (outcome === "unavailable") {
    const reason = value.reason;
    if (typeof reason !== "string" || !UNAVAILABLE_REASONS.has(reason)) {
      return { outcome: "invalid_provider_response", ...metadata };
    }
    return {
      outcome: "unavailable",
      reason: reason as CheckpointProviderUnavailableReason,
      ...metadata,
    };
  }

  return {
    outcome: outcome as Exclude<CheckpointProviderOutcomeKind, "unavailable">,
    ...metadata,
  };
}

/**
 * Call a provider exactly once, under a bounded deadline, never trusting it to
 * settle, throw safely, or respect the contract.
 *
 * A rejection, a hang, or a non-conforming value all reduce to a typed outcome.
 * There is NO automatic retry: retrying inside the request would multiply load
 * on a provider that is already failing and would hide the failure from the
 * learner-visible cooldown.
 */
export async function callCheckpointProvider(
  provider: CheckpointBalanceProvider,
  request: Omit<CheckpointProviderRequest, "timeoutSignal">,
  timeoutMs: number,
): Promise<CheckpointProviderResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const timedOut = new Promise<CheckpointProviderResult>((resolve) => {
    controller.signal.addEventListener(
      "abort",
      () => resolve({ outcome: "unavailable", reason: "provider_timeout" }),
      { once: true },
    );
  });
  try {
    const settled = await Promise.race([
      Promise.resolve()
        .then(() =>
          provider.verifyThreshold({ ...request, timeoutSignal: controller.signal }),
        )
        // A provider that throws produced no conforming answer — which is not
        // the same as "not met" and not the same as a provider that politely
        // declined. The thrown value is deliberately never inspected, logged or
        // attached: it is the one place a real adapter could quote a balance.
        .catch((): CheckpointProviderResult => ({
          outcome: "invalid_provider_response",
        })),
      timedOut,
    ]);
    return normalizeCheckpointProviderResult(settled);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
