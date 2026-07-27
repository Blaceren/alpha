/**
 * V2 financial-checkpoint verification state (L4HG-1 — honest gate).
 *
 * A `financial_checkpoint` level is completed by an authoritative statement
 * about the learner's REAL trading balance. No such authority exists in this
 * platform yet: there is no configured balance provider, and
 * `docs/V2_PRODUCT_DECISIONS.md` §6 forbids simulating a production balance
 * check. Until that is resolved (see docs/L4_CHECKPOINT_HANDOFF.md), the only
 * truthful answer this module may give is `verification_unavailable`.
 *
 * The distinction this module exists to protect: **unavailable is not
 * not-met**. Reporting "you have not reached $50" when the platform simply
 * cannot look would be a false statement about a real person's money, and
 * `docs/V2_PRODUCT_DECISIONS.md` requires `verification_unavailable` to be its
 * own explicit state rather than a below-threshold measurement.
 *
 * Nothing here reads, derives, receives or returns a balance. There is no
 * provider call, no Pocket request and no learner input. The resolver is a pure
 * function of the feature flag and the level's own definition, so it cannot
 * leak a financial value even by accident.
 */
import { isCurriculumV2CheckpointEnabled } from "@/lib/env";

/**
 * Learner-visible verification state. A single member today, deliberately
 * modelled as a union so the future engine ADDS `verified` / `not_met` rather
 * than reinterpreting an existing value.
 */
export type CheckpointVerificationState = "verification_unavailable";

/**
 * Why verification is unavailable. Operational, never financial: no member of
 * this union can describe the learner's money.
 */
export type CheckpointVerificationReason =
  /** `CURRICULUM_V2_CHECKPOINT_ENABLED` is absent or false. */
  | "checkpoint_disabled"
  /** Flag on, but no authoritative balance provider is configured. */
  | "provider_unconfigured"
  /** The level's integration code is missing or not a recognised checkpoint. */
  | "integration_unknown";

/**
 * The bounded checkpoint object exposed to the learner read model.
 *
 * Forbidden by contract and by construction: observed balance, remaining
 * amount, deposits, demo balance, account identifiers, provider payloads, or an
 * open `Json` bag that a later change could quietly fill with any of those.
 */
export type CheckpointReadModel = {
  kind: "financial_checkpoint";
  /** Recognised integration code, or null when it fails closed. */
  integrationCode: string | null;
  verificationState: CheckpointVerificationState;
  verificationReason: CheckpointVerificationReason;
  /** No verification can be requested while no authority exists. */
  canVerify: false;
  /** A checkpoint is never an ordinary startable learning level. */
  canStart: false;
  /** No completion owner exists for `financial_checkpoint:balance_check`. */
  canComplete: false;
};

/**
 * Recognised checkpoint integration codes. Bounded on purpose: an unknown code
 * is a definition the runtime does not understand, and the safe response to
 * "I do not know what this gate is" is to keep the gate shut.
 */
const KNOWN_INTEGRATION_CODES = new Set<string>(["checkpoint.module-01"]);

/** Shape guard for a checkpoint integration code (`checkpoint.<segment>`). */
const INTEGRATION_CODE_PATTERN = /^checkpoint\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isKnownCheckpointIntegrationCode(code: string | null | undefined): boolean {
  if (typeof code !== "string") return false;
  if (!INTEGRATION_CODE_PATTERN.test(code)) return false;
  return KNOWN_INTEGRATION_CODES.has(code);
}

/**
 * Whether an authoritative balance provider is configured.
 *
 * Always false. This is the single seam the future verification engine will
 * replace; it is a named function rather than an inline `false` so that the
 * absence of a provider is an explicit, testable platform fact rather than an
 * omission someone has to notice.
 *
 * `src/lib/exchange/balanceProvider.ts` is NOT such an authority: `sandbox`
 * reads a deposit accumulator (rejected by product decisions §6) and
 * `real_placeholder` is an unimplemented stub. Neither is consulted here, and
 * no call is made to either.
 */
export function hasAuthoritativeCheckpointProvider(): boolean {
  return false;
}

export type ResolveCheckpointInput = {
  /** `LevelDefinition.featureUnlockCode` for the checkpoint level. */
  integrationCode: string | null;
  env?: NodeJS.ProcessEnv;
};

/**
 * Resolve the checkpoint read model. Fail-closed in every branch: the result is
 * `verification_unavailable` whether the flag is off, the flag is on without a
 * provider, or the integration code is unrecognised.
 */
export function resolveCheckpointVerification({
  integrationCode,
  env = process.env,
}: ResolveCheckpointInput): CheckpointReadModel {
  const known = isKnownCheckpointIntegrationCode(integrationCode);
  const reason: CheckpointVerificationReason = !isCurriculumV2CheckpointEnabled(env)
    ? "checkpoint_disabled"
    : !known
      ? "integration_unknown"
      : !hasAuthoritativeCheckpointProvider()
        ? "provider_unconfigured"
        : // Unreachable while `hasAuthoritativeCheckpointProvider` is false. Kept
          // so adding a provider is a deliberate edit here rather than a silent
          // fallthrough into a state this phase never designed.
          "provider_unconfigured";

  return {
    kind: "financial_checkpoint",
    integrationCode: known ? integrationCode : null,
    verificationState: "verification_unavailable",
    verificationReason: reason,
    canVerify: false,
    canStart: false,
    canComplete: false,
  };
}

/** True for the one level type this module governs. */
export function isFinancialCheckpointType(type: string): boolean {
  return type === "financial_checkpoint";
}
