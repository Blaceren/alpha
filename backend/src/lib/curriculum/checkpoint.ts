/**
 * V2 financial-checkpoint read model (L4HG-1 honest gate, extended by L4VC-1).
 *
 * A `financial_checkpoint` level is completed by an authoritative statement
 * about whether the learner's REAL balance reached a published threshold.
 * L4VC-1 builds the engine that can carry such a statement, but it deliberately
 * ships with NO real provider: the seam is complete, the adapter is not
 * (docs/POCKET_ADAPTER_HANDOFF.md).
 *
 * The distinction this module exists to protect is unchanged: **unavailable is
 * not not-met**. Saying "you have not reached $50" when the platform could not
 * look would be a false statement about a real person's money, so the two are
 * separate states and always will be.
 *
 * NOTHING HERE CARRIES AN AMOUNT. The resolver receives a configured threshold
 * and a typed outcome; it never receives, derives or returns an observed
 * balance. The read model has no field one could occupy — see
 * `CheckpointReadModel`.
 *
 * FAIL-CLOSED BY CONSTRUCTION. Every branch that is not an explicit, fully
 * satisfied "the learner may ask" resolves to `verification_unavailable`.
 */
import {
  isCurriculumV2CheckpointEnabled,
  isPocketBalanceProviderEnabled,
  isCheckpointProviderTestBackendEnabled,
} from "@/lib/env";
import {
  disabledCheckpointProvider,
  unconfiguredCheckpointProvider,
  type CheckpointBalanceProvider,
} from "./checkpoint-provider";
import { resolvePocketPartnerProvider } from "./checkpoint-provider-pocket";
import { resolveDevSimulatorProvider } from "./checkpoint-provider-dev-simulator";
import { effectiveCheckpointProviderMode } from "./checkpoint-provider-mode";
import { ATA_CHECKPOINT_INTEGRATION_CODES } from "./product-ata-100";

/**
 * Learner-visible verification state.
 *
 * `verification_unavailable` remains the single umbrella for "the platform
 * cannot answer", with the operational detail in `verificationReason`. Keeping
 * it that way is what preserves the shipped honest gate byte-for-byte while the
 * flags are off.
 */
export type CheckpointVerificationState =
  | "verification_unavailable"
  | "ready"
  | "checking"
  | "cooldown"
  | "not_met"
  | "completed";

/**
 * Why. Operational or threshold-shaped, never financial: no member of this
 * union can describe how much money the learner has.
 */
export type CheckpointVerificationReason =
  /**
   * Nothing for the checkpoint to explain: either the state speaks for itself
   * (ready / checking / completed), or the LEVEL state already carries the
   * explanation (the learner has not reached the gate yet).
   */
  | "none"
  /** `CURRICULUM_V2_CHECKPOINT_ENABLED` is absent or false. */
  | "checkpoint_disabled"
  /** Checkpoint on, but `POCKET_BALANCE_PROVIDER_ENABLED` is absent or false. */
  | "provider_disabled"
  /** Both flags on, but no balance adapter is wired into this build. */
  | "provider_unconfigured"
  /** No `LevelCheckpointRequirement` row exists for this level. */
  | "requirement_unconfigured"
  /** The level's integration code is missing or not a recognised checkpoint. */
  | "integration_unknown"
  /** No provider account is linked to this learner. */
  | "identity_unlinked"
  /** A linked account belongs to a different identity. */
  | "identity_mismatch"
  /** The account currency cannot be compared to the configured threshold. */
  | "unsupported_currency"
  | "provider_timeout"
  | "provider_maintenance"
  | "provider_rate_limited"
  /** The provider answered from data too old to be authoritative. */
  | "stale"
  /** The provider answered outside its contract. */
  | "invalid_provider_response"
  /** A recent attempt means the learner must wait before asking again. */
  | "cooldown_active"
  /** The learner has spent the hourly attempt allowance. */
  | "rate_limited"
  /** The configured threshold was not reached. */
  | "not_met";

/**
 * The bounded checkpoint object exposed to the learner read model.
 *
 * Forbidden by contract AND by construction: observed balance, remaining
 * amount, deposits, demo balance, account identifiers, provider payloads, or an
 * open `Json` bag a later change could quietly fill with any of those.
 *
 * `canStart` and `canComplete` are literal `false` on purpose. A checkpoint is
 * never an ordinary startable level, and the learner never completes it
 * directly — verification is the only completion owner, so a client that
 * offered a "complete" button would be offering something no route accepts.
 */
export type CheckpointReadModel = {
  kind: "financial_checkpoint";
  /** Recognised integration code, or null when it fails closed. */
  integrationCode: string | null;
  verificationState: CheckpointVerificationState;
  verificationReason: CheckpointVerificationReason;
  /** True only when a verification request would actually be accepted. */
  canVerify: boolean;
  canStart: false;
  canComplete: false;
  /** Seconds to wait before retrying, when the state implies waiting. */
  retryAfterSeconds: number | null;
};

/**
 * Recognised checkpoint integration codes. Bounded on purpose: an unknown code
 * is a definition the runtime does not understand, and the safe response to
 * "I do not know what this gate is" is to keep the gate shut.
 *
 * G3 — DERIVED, NOT HAND-WRITTEN. This was `new Set(["checkpoint.module-01"])`,
 * a literal that was accurate while only level 4's gate existed and silently
 * wrong from the moment the canonical 100-level product shipped nineteen more.
 * The set now comes from `ATA_CHECKPOINT_INTEGRATION_CODES`, which the canonical
 * product definition builds with `gateIntegrationCode` — the same function the
 * package builder uses to write `LevelDefinition.featureUnlockCode`. One
 * expression produces both strings, so the allowlist cannot fall behind a
 * curriculum again.
 *
 * The bound is unchanged in kind: this is still an exact-membership test against
 * a closed set, and a code outside it is still refused. What changed is where the
 * set comes from.
 */
const KNOWN_INTEGRATION_CODES: ReadonlySet<string> = new Set<string>(
  ATA_CHECKPOINT_INTEGRATION_CODES,
);

/** Shape guard for a checkpoint integration code (`checkpoint.<segment>`). */
const INTEGRATION_CODE_PATTERN = /^checkpoint\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isKnownCheckpointIntegrationCode(code: string | null | undefined): boolean {
  if (typeof code !== "string") return false;
  if (!INTEGRATION_CODE_PATTERN.test(code)) return false;
  return KNOWN_INTEGRATION_CODES.has(code);
}

/* ------------------------------------------------------------------------ */
/* Provider selection                                                        */
/* ------------------------------------------------------------------------ */

export type CheckpointProviderResolution = {
  provider: CheckpointBalanceProvider;
  /** True only when a provider capable of answering has been selected. */
  usable: boolean;
  /** The reason to report when `usable` is false. */
  reason: Extract<
    CheckpointVerificationReason,
    "none" | "checkpoint_disabled" | "provider_disabled" | "provider_unconfigured"
  >;
};

/**
 * A test-only provider factory, installed by regression suites.
 *
 * It is a module-level slot rather than an import so that no production code
 * path can reach the mock: selecting it additionally requires a non-production
 * runtime AND the exact opt-in marker, which production env validation rejects
 * outright.
 */
let testProviderFactory: (() => CheckpointBalanceProvider) | null = null;

/** Regression-only. Returns a disposer that restores the previous state. */
export function __setCheckpointTestProvider(
  factory: (() => CheckpointBalanceProvider) | null,
): () => void {
  const previous = testProviderFactory;
  testProviderFactory = factory;
  return () => {
    testProviderFactory = previous;
  };
}

/**
 * Decide which provider answers, from flags alone.
 *
 * The two flags ask different questions and are checked in order: may the
 * platform run a checkpoint at all, and may it ask a balance provider. Neither
 * substitutes for the other, and the shipped state (both absent) selects the
 * disabled provider.
 */
export function resolveCheckpointProvider(
  env: NodeJS.ProcessEnv = process.env,
): CheckpointProviderResolution {
  if (!isCurriculumV2CheckpointEnabled(env)) {
    return {
      provider: disabledCheckpointProvider,
      usable: false,
      reason: "checkpoint_disabled",
    };
  }
  if (!isPocketBalanceProviderEnabled(env)) {
    return {
      provider: disabledCheckpointProvider,
      usable: false,
      reason: "provider_disabled",
    };
  }
  if (testProviderFactory && isCheckpointProviderTestBackendEnabled(env)) {
    return { provider: testProviderFactory(), usable: true, reason: "none" };
  }

  // L4DSP-1: the explicit provider-selection contract. Reached only after BOTH
  // capability flags have already said yes, so a mode can choose between
  // implementations but can never grant permission to run one.
  //
  // A typo resolves to `null` and stops here. There is no "fall back to the
  // configured adapter" branch, because the two ways a fallback could go are
  // both unacceptable: silently answering a financial question with a simulator,
  // or silently asking Pocket about a learner when the operator asked for a
  // simulator.
  const mode = effectiveCheckpointProviderMode(env);
  if (mode === null) {
    return {
      provider: unconfiguredCheckpointProvider,
      usable: false,
      reason: "provider_unconfigured",
    };
  }
  if (mode === "disabled") {
    return {
      provider: disabledCheckpointProvider,
      usable: false,
      reason: "provider_disabled",
    };
  }
  if (mode === "dev_simulator") {
    // The environment gate lives inside the resolver, NOT in the caller: asking
    // for the simulator on a host that is not authoritatively `dev` produces
    // `unconfigured` and never falls through to Pocket. Note that this branch
    // cannot be reached by accident — `dev_simulator` has to be spelled out,
    // and absence resolves to `pocket_partner` below.
    const simulator = resolveDevSimulatorProvider(env);
    if (simulator) {
      return { provider: simulator, usable: true, reason: "none" };
    }
    return {
      provider: unconfiguredCheckpointProvider,
      usable: false,
      reason: "provider_unconfigured",
    };
  }

  // L4PA-1: the official Pocket Partner adapter, selected only when its own
  // configuration fully validates (HTTPS, the exact approved host, a positive
  // Partner ID and a non-synthetic token — see pocketPartnerConfig.ts).
  //
  // There is deliberately NO fallback in either direction. An invalid Pocket
  // configuration falls through to `unconfigured`, never to the mock: silently
  // answering a financial question with a test double would be far worse than
  // refusing to answer. And the mock branch above requires its own marker, so
  // a production process cannot reach it however this branch resolves.
  const pocketProvider = resolvePocketPartnerProvider(env);
  if (pocketProvider) {
    return { provider: pocketProvider, usable: true, reason: "none" };
  }
  // The capability is granted but no adapter is configured. Granting permission
  // must never manufacture an answer about someone's money.
  return {
    provider: unconfiguredCheckpointProvider,
    usable: false,
    reason: "provider_unconfigured",
  };
}

/**
 * Whether an authoritative balance provider is configured.
 *
 * Retained as the named platform fact it has always been; it now delegates to
 * the provider resolution so "is there an authority?" has exactly one answer.
 */
export function hasAuthoritativeCheckpointProvider(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveCheckpointProvider(env).usable;
}

/* ------------------------------------------------------------------------ */
/* Read-model resolution                                                     */
/* ------------------------------------------------------------------------ */

/** The configured threshold, as the read model is allowed to see it. */
export type CheckpointRequirementSnapshot = {
  integrationCode: string;
  thresholdCurrency: string;
  thresholdMinorUnits: number;
};

/**
 * The last attempt, reduced to what the read model needs.
 *
 * Note what is NOT here: no provider payload, no observed amount, no account.
 * Just an outcome name and two timestamps.
 */
export type CheckpointAttemptSnapshot = {
  outcome: string;
  cooldownUntil: Date | null;
  completedAt: Date | null;
};

export type ResolveCheckpointInput = {
  /** `LevelDefinition.featureUnlockCode` for the checkpoint level. */
  integrationCode: string | null;
  /** The configured requirement, when one exists. */
  requirement?: CheckpointRequirementSnapshot | null;
  /** The learner's most recent attempt on this level, when one exists. */
  latestAttempt?: CheckpointAttemptSnapshot | null;
  /** True once the level's durable progress is `completed`. */
  completed?: boolean;
  /**
   * True when the learner is structurally standing at this gate (sequence
   * complete, level current). A learner who has not arrived is never told the
   * gate is `ready`.
   */
  reachable?: boolean;
  env?: NodeJS.ProcessEnv;
  now?: Date;
};

/** Provider outcomes that map straight onto a learner-visible reason. */
const OUTCOME_REASON: Record<string, CheckpointVerificationReason> = {
  identity_unlinked: "identity_unlinked",
  identity_mismatch: "identity_mismatch",
  unsupported_currency: "unsupported_currency",
  provider_timeout: "provider_timeout",
  provider_maintenance: "provider_maintenance",
  provider_rate_limited: "provider_rate_limited",
  provider_disabled: "provider_disabled",
  provider_unconfigured: "provider_unconfigured",
  stale: "stale",
  invalid_provider_response: "invalid_provider_response",
};

function model(
  fields: Partial<CheckpointReadModel> & {
    verificationState: CheckpointVerificationState;
    verificationReason: CheckpointVerificationReason;
  },
): CheckpointReadModel {
  return {
    kind: "financial_checkpoint",
    integrationCode: null,
    canVerify: false,
    canStart: false,
    canComplete: false,
    retryAfterSeconds: null,
    ...fields,
  };
}

function secondsUntil(target: Date, now: Date): number {
  return Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 1_000));
}

/**
 * Resolve the checkpoint read model.
 *
 * Ordering matters and is deliberate:
 *   completed -> flags -> integration code -> requirement -> in-flight ->
 *   cooldown -> last outcome -> ready.
 *
 * A completed checkpoint reads as completed regardless of flags, because
 * turning a flag off must not retract a fact about the learner's history.
 * Everything else fails closed.
 */
export function resolveCheckpointVerification({
  integrationCode,
  requirement = null,
  latestAttempt = null,
  completed = false,
  reachable = false,
  env = process.env,
  now = new Date(),
}: ResolveCheckpointInput): CheckpointReadModel {
  const known = isKnownCheckpointIntegrationCode(integrationCode);
  const code = known ? integrationCode : null;

  // A passed gate stays passed. Flags govern whether a NEW question may be
  // asked, never whether an answered one is retracted.
  if (completed) {
    return model({
      integrationCode: code,
      verificationState: "completed",
      verificationReason: "none",
    });
  }

  // Ordering is load-bearing and matches the shipped honest gate exactly:
  //   checkpoint flag -> integration code -> provider -> requirement.
  //
  // While the checkpoint is switched off the platform has not looked at the
  // level at all, so it cannot honestly blame the integration code. Once it is
  // on, the code is a property of the DEFINITION and is knowable without any
  // provider — so an unrecognised gate is reported as such rather than being
  // masked by whichever provider happens to be wired.
  if (!isCurriculumV2CheckpointEnabled(env)) {
    return model({
      integrationCode: code,
      verificationState: "verification_unavailable",
      verificationReason: "checkpoint_disabled",
    });
  }

  if (!known) {
    return model({
      integrationCode: null,
      verificationState: "verification_unavailable",
      verificationReason: "integration_unknown",
    });
  }

  const resolution = resolveCheckpointProvider(env);
  if (!resolution.usable) {
    return model({
      integrationCode: code,
      verificationState: "verification_unavailable",
      verificationReason: resolution.reason,
    });
  }

  // A gate with no published threshold is not a gate. The platform will not
  // invent one, and will not ask a provider to compare against nothing.
  if (
    !requirement ||
    requirement.integrationCode !== integrationCode ||
    requirement.thresholdCurrency !== "USD" ||
    !Number.isSafeInteger(requirement.thresholdMinorUnits) ||
    requirement.thresholdMinorUnits <= 0
  ) {
    return model({
      integrationCode: code,
      verificationState: "verification_unavailable",
      verificationReason: "requirement_unconfigured",
    });
  }

  if (latestAttempt) {
    // Claimed but unanswered: a request is in flight. Reported as `checking` so
    // the learner sees progress rather than a second verify button.
    if (latestAttempt.completedAt === null && latestAttempt.outcome === "in_progress") {
      return model({
        integrationCode: code,
        verificationState: "checking",
        verificationReason: "none",
      });
    }
    if (latestAttempt.cooldownUntil && latestAttempt.cooldownUntil > now) {
      return model({
        integrationCode: code,
        verificationState: "cooldown",
        verificationReason: "cooldown_active",
        retryAfterSeconds: secondsUntil(latestAttempt.cooldownUntil, now),
      });
    }
    // Cooldown has expired: report WHY the last attempt did not pass, and allow
    // another. `not_met` is a distinct state from every unavailable reason.
    if (latestAttempt.outcome === "not_met") {
      return model({
        integrationCode: code,
        verificationState: "not_met",
        verificationReason: "not_met",
        canVerify: reachable,
      });
    }
    const reason = OUTCOME_REASON[latestAttempt.outcome];
    if (reason) {
      return model({
        integrationCode: code,
        verificationState: "verification_unavailable",
        verificationReason: reason,
        canVerify: reachable,
      });
    }
  }

  // Configured and answerable. A learner who has not yet arrived at the gate is
  // not offered verification, and the reason is `none` on purpose: the gate is
  // fine, and "you have not got here yet" is already carried honestly by the
  // LEVEL state (locked + sequence_incomplete). Restating it here as a fault of
  // the checkpoint would be wrong.
  return model({
    integrationCode: code,
    verificationState: reachable ? "ready" : "verification_unavailable",
    verificationReason: "none",
    canVerify: reachable,
  });
}

/** True for the one level type this module governs. */
export function isFinancialCheckpointType(type: string): boolean {
  return type === "financial_checkpoint";
}
