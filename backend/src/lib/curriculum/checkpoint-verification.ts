/**
 * L4VC-1 — the financial-checkpoint verification command.
 *
 * This is the only code path that may complete an L4 financial checkpoint. It
 * is provider-neutral: it knows there is a `CheckpointBalanceProvider` and what
 * the typed answers mean, and nothing whatsoever about Pocket, HTTP, tokens or
 * account shapes. Substituting the real adapter later must not require an edit
 * in this file.
 *
 * SEQUENCE (each step fails closed before the next is attempted)
 *   1. flags + provider selection      7. resolve idempotent receipt
 *   2. enrollment ownership            8. cooldown
 *   3. level is the current checkpoint 9. rolling-hour rate limit
 *   4. previous level completed       10. ONE provider call, bounded deadline
 *   5. requirement configured         11. reduce to a typed outcome
 *   6. requestId validity             12. persist the typed attempt
 *                                     13. on `met` only: complete the level once
 *
 * WHAT IS NOT HERE, BY DESIGN
 *   no background polling · no automatic provider retry · no staff override ·
 *   no learner-supplied balance/currency/account/amount · no observed value
 *   persisted, returned or logged.
 *
 * TRANSACTION SHAPE. The provider is called BETWEEN two short transactions, not
 * inside one. A network call inside a SQLite write transaction would hold the
 * database for the provider's latency; the claim/settle split keeps every
 * transaction short while the unique index still guarantees one provider call
 * per request identity.
 */
import {
  Prisma,
  type CheckpointVerificationOutcome,
  type PrismaClient,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  isFinancialCheckpointType,
  resolveCheckpointProvider,
  type CheckpointVerificationReason,
  type CheckpointVerificationState,
} from "./checkpoint";
import {
  callCheckpointProvider,
  type CheckpointProviderResult,
} from "./checkpoint-provider";
import {
  completeCurriculumLevelInTransaction,
  isCurriculumLevelCompletionError,
} from "./completion";
import { CURRICULUM_AUDIT_ACTIONS } from "./constants";

/**
 * Initial ATA operational defaults (L4VC-1).
 *
 * These are OUR numbers, chosen for this platform. They are NOT derived from
 * any Pocket documentation, quota or rate limit — none has been received. When
 * the real adapter arrives its provider limits are an additional constraint on
 * top of these, not a replacement for them.
 */
export const CHECKPOINT_VERIFICATION_DEFAULTS = {
  /** Minimum wait between two verification attempts on the same level. */
  cooldownSeconds: 60,
  /** Attempts a learner may make per rolling hour, per level. */
  rateLimitAttempts: 5,
  rateLimitWindowSeconds: 3_600,
  /** Bounded deadline for a single provider call. */
  providerTimeoutMs: 5_000,
  /** Automatic in-request retries. Zero, deliberately. */
  providerRetries: 0,
} as const;

export type CheckpointVerificationConfig = {
  cooldownSeconds: number;
  rateLimitAttempts: number;
  rateLimitWindowSeconds: number;
  providerTimeoutMs: number;
};

/** requestId: same identity charset the report/assessment runtimes use. */
export const CHECKPOINT_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/;

export type CheckpointVerificationErrorCode =
  | "CHECKPOINT_DISABLED"
  | "CHECKPOINT_INPUT_INVALID"
  | "CHECKPOINT_NOT_ENROLLED"
  | "CHECKPOINT_FORBIDDEN"
  | "CHECKPOINT_LEVEL_NOT_FOUND"
  | "CHECKPOINT_LEVEL_WRONG_TYPE"
  | "CHECKPOINT_LEVEL_NOT_CURRENT"
  | "CHECKPOINT_SEQUENCE_INCOMPLETE"
  | "CHECKPOINT_REQUIREMENT_UNCONFIGURED"
  | "CHECKPOINT_REQUEST_CONFLICT"
  | "CHECKPOINT_STATE_CORRUPT"
  | "CHECKPOINT_INTERNAL_ERROR";

export class CheckpointVerificationError extends Error {
  readonly code: CheckpointVerificationErrorCode;
  constructor(code: CheckpointVerificationErrorCode, message: string) {
    super(message);
    this.name = "CheckpointVerificationError";
    this.code = code;
  }
}

export function isCheckpointVerificationError(
  error: unknown,
): error is CheckpointVerificationError {
  return error instanceof CheckpointVerificationError;
}

function fail(code: CheckpointVerificationErrorCode, message: string): never {
  throw new CheckpointVerificationError(code, message);
}

/**
 * The learner-facing receipt.
 *
 * Every field is either a typed state, a wait hint, or level progression. There
 * is no amount, no currency the learner holds, no account and no provider
 * payload — the response DTO is built from this and nothing else.
 */
export type CheckpointVerificationReceipt = {
  verificationState: CheckpointVerificationState;
  verificationReason: CheckpointVerificationReason;
  retryAfterSeconds: number | null;
  /** True only when this call (or the call it replays) completed the level. */
  completed: boolean;
  /** True when the result was replayed from a durable receipt. */
  replayed: boolean;
  attemptId: number;
  levelNumber: number;
  stableCode: string;
  nextLevelNumber: number | null;
  /** A financial checkpoint is a zero-reward level. Always 0, always null. */
  xpAwarded: 0;
  xpTransactionId: null;
};

export type VerifyCheckpointInput = {
  actorUserId: number;
  stableCode: string;
  requestId: string;
  evaluationTime?: Date;
  config?: Partial<CheckpointVerificationConfig>;
  db?: PrismaClient;
  env?: NodeJS.ProcessEnv;
};

type Claim = {
  attemptId: number;
  enrollmentId: number;
  levelDefinitionId: number;
  levelNumber: number;
  stableCode: string;
  learnerId: number;
  integrationCode: string;
  thresholdMinorUnits: number;
  maxLevel: number;
};

type ClaimResult =
  | { kind: "claimed"; claim: Claim }
  | { kind: "receipt"; receipt: CheckpointVerificationReceipt };

/** Provider outcome -> durable attempt outcome. A total, explicit mapping. */
function durableOutcome(result: CheckpointProviderResult): CheckpointVerificationOutcome {
  if (result.outcome === "unavailable") return result.reason;
  return result.outcome;
}

/** Durable attempt outcome -> learner-visible state + reason. */
function presentation(outcome: string): {
  state: CheckpointVerificationState;
  reason: CheckpointVerificationReason;
} {
  switch (outcome) {
    case "met":
      return { state: "completed", reason: "none" };
    case "not_met":
      return { state: "not_met", reason: "not_met" };
    case "in_progress":
      return { state: "checking", reason: "none" };
    case "identity_unlinked":
    case "identity_mismatch":
    case "unsupported_currency":
    case "provider_timeout":
    case "provider_maintenance":
    case "provider_rate_limited":
    case "provider_disabled":
    case "provider_unconfigured":
    case "stale":
    case "invalid_provider_response":
      return {
        state: "verification_unavailable",
        reason: outcome as CheckpointVerificationReason,
      };
    default:
      // An outcome this build does not understand keeps the gate shut rather
      // than falling through to anything permissive.
      return {
        state: "verification_unavailable",
        reason: "invalid_provider_response",
      };
  }
}

function resolvedConfig(
  overrides: Partial<CheckpointVerificationConfig> | undefined,
): CheckpointVerificationConfig {
  const config = { ...CHECKPOINT_VERIFICATION_DEFAULTS, ...(overrides ?? {}) };
  if (
    !Number.isSafeInteger(config.cooldownSeconds) ||
    config.cooldownSeconds < 0 ||
    !Number.isSafeInteger(config.rateLimitAttempts) ||
    config.rateLimitAttempts < 1 ||
    !Number.isSafeInteger(config.rateLimitWindowSeconds) ||
    config.rateLimitWindowSeconds < 1 ||
    !Number.isSafeInteger(config.providerTimeoutMs) ||
    config.providerTimeoutMs < 1
  ) {
    fail("CHECKPOINT_INPUT_INVALID", "checkpoint verification config is invalid");
  }
  return {
    cooldownSeconds: config.cooldownSeconds,
    rateLimitAttempts: config.rateLimitAttempts,
    rateLimitWindowSeconds: config.rateLimitWindowSeconds,
    providerTimeoutMs: config.providerTimeoutMs,
  };
}

function secondsUntil(target: Date, now: Date): number {
  return Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 1_000));
}

function receiptFrom(
  attempt: {
    id: number;
    outcome: string;
    cooldownUntil: Date | null;
    completedAt: Date | null;
  },
  level: { levelNumber: number; stableCode: string; maxLevel: number },
  now: Date,
  options: { completed: boolean; replayed: boolean },
): CheckpointVerificationReceipt {
  const view = presentation(attempt.outcome);
  const cooling =
    attempt.cooldownUntil && attempt.cooldownUntil > now
      ? secondsUntil(attempt.cooldownUntil, now)
      : null;
  return {
    verificationState: view.state,
    verificationReason: view.reason,
    // The wait hint is attached to the outcome the learner actually sees; a
    // completed checkpoint never advertises a retry.
    retryAfterSeconds: view.state === "completed" ? null : cooling,
    completed: options.completed,
    replayed: options.replayed,
    attemptId: attempt.id,
    levelNumber: level.levelNumber,
    stableCode: level.stableCode,
    nextLevelNumber:
      options.completed && level.levelNumber < level.maxLevel
        ? level.levelNumber + 1
        : null,
    xpAwarded: 0,
    xpTransactionId: null,
  };
}

/**
 * A non-persisting refusal (flags off, cooldown, rate limit).
 *
 * These never create an attempt row: the attempt table means "the platform
 * asked a provider", and inflating it with refusals would corrupt both the
 * cooldown window and the hourly allowance it is derived from.
 */
export type CheckpointVerificationRefusal = {
  kind: "refused";
  verificationState: CheckpointVerificationState;
  verificationReason: CheckpointVerificationReason;
  retryAfterSeconds: number | null;
};

export type VerifyCheckpointResult =
  | ({ kind: "receipt" } & CheckpointVerificationReceipt)
  | CheckpointVerificationRefusal;

function refuse(
  state: CheckpointVerificationState,
  reason: CheckpointVerificationReason,
  retryAfterSeconds: number | null = null,
): CheckpointVerificationRefusal {
  return { kind: "refused", verificationState: state, verificationReason: reason, retryAfterSeconds };
}

/* ------------------------------------------------------------------------ */
/* Phase 1 — validate and claim                                              */
/* ------------------------------------------------------------------------ */

async function claim(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: number;
    stableCode: string;
    requestId: string;
    now: Date;
    config: CheckpointVerificationConfig;
  },
): Promise<ClaimResult | CheckpointVerificationRefusal> {
  const { actorUserId, stableCode, requestId, now, config } = input;

  // 2. Ownership. The enrollment is resolved FROM the session user, never from
  // a client-supplied id, so there is no enrollment to authorize against.
  const user = await tx.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, status: true },
  });
  if (!user) fail("CHECKPOINT_FORBIDDEN", "actor does not exist");
  if (user.status !== "active") fail("CHECKPOINT_FORBIDDEN", "actor is not active");

  // A checkpoint that PASSES the final level terminally completes the
  // enrollment, so a replay of that very receipt must still resolve. The
  // enrollment is therefore selected by ownership, not by "still active" —
  // whether a NEW attempt is allowed is decided further down, once replay has
  // had its chance.
  const enrollment = await tx.userCurriculumEnrollment.findFirst({
    where: { userId: actorUserId, status: { in: ["active", "completed"] } },
    orderBy: [{ status: "asc" }, { id: "desc" }],
    include: { curriculumVersion: { include: { levels: true } } },
  });
  if (!enrollment) fail("CHECKPOINT_NOT_ENROLLED", "no curriculum enrollment");

  const levels = enrollment.curriculumVersion.levels;
  const level = levels.find((candidate) => candidate.stableCode === stableCode);
  if (!level) fail("CHECKPOINT_LEVEL_NOT_FOUND", "level is not in the pinned curriculum");
  if (!isFinancialCheckpointType(level.type)) {
    fail("CHECKPOINT_LEVEL_WRONG_TYPE", "level is not a financial checkpoint");
  }
  const maxLevel = levels.reduce((max, candidate) => Math.max(max, candidate.levelNumber), 0);
  const levelView = {
    levelNumber: level.levelNumber,
    stableCode: level.stableCode,
    maxLevel,
  };

  const levelProgress = await tx.userLevelProgress.findFirst({
    where: { enrollmentId: enrollment.id, levelDefinitionId: level.id },
    select: { status: true },
  });
  const alreadyPassed = levelProgress?.status === "completed";

  // 7. Idempotent replay. Same identity -> the original result, with NO second
  // provider call. Checked before the "may you ask again?" rules, because a
  // replay is not a new question.
  const existing = await tx.checkpointVerificationAttempt.findUnique({
    where: {
      enrollmentId_levelDefinitionId_requestId: {
        enrollmentId: enrollment.id,
        levelDefinitionId: level.id,
        requestId,
      },
    },
  });
  if (existing) {
    return {
      kind: "receipt",
      receipt: receiptFrom(existing, levelView, now, {
        completed: existing.outcome === "met" && alreadyPassed,
        replayed: true,
      }),
    };
  }

  // The same requestId aimed at a DIFFERENT level of this enrollment is a
  // client bug, not a replay. Bounded conflict: no provider call, no row.
  const reused = await tx.checkpointVerificationAttempt.findFirst({
    where: { enrollmentId: enrollment.id, requestId },
    select: { id: true },
  });
  if (reused) {
    fail("CHECKPOINT_REQUEST_CONFLICT", "requestId is already used for another level");
  }

  // Already passed under a different request identity. There is nothing left to
  // verify, so the last receipt is returned instead of a new provider call.
  const latest = await tx.checkpointVerificationAttempt.findFirst({
    where: { enrollmentId: enrollment.id, levelDefinitionId: level.id },
    orderBy: { id: "desc" },
  });
  if (alreadyPassed && latest && latest.outcome === "met") {
    return {
      kind: "receipt",
      receipt: receiptFrom(latest, levelView, now, { completed: true, replayed: true }),
    };
  }

  // From here on this is a NEW question, so the full preconditions apply.
  if (enrollment.status !== "active") {
    fail("CHECKPOINT_NOT_ENROLLED", "no active curriculum enrollment");
  }

  // 3 + 4. The gate must be the level the learner is actually standing on,
  // which (given the enrollment invariant currentLevel === highestCompleted + 1)
  // is exactly "everything before it is complete".
  if (level.levelNumber !== enrollment.currentLevel) {
    fail("CHECKPOINT_LEVEL_NOT_CURRENT", "checkpoint is not the current level");
  }
  if (enrollment.highestCompletedLevel !== level.levelNumber - 1) {
    fail("CHECKPOINT_SEQUENCE_INCOMPLETE", "previous levels are not complete");
  }

  // 5. A gate with no published threshold is not verified; the platform will
  // not invent one.
  const requirement = await tx.levelCheckpointRequirement.findUnique({
    where: { levelDefinitionId: level.id },
  });
  if (
    !requirement ||
    requirement.integrationCode !== level.featureUnlockCode ||
    requirement.thresholdCurrency !== "USD" ||
    !Number.isSafeInteger(requirement.thresholdMinorUnits) ||
    requirement.thresholdMinorUnits <= 0
  ) {
    fail("CHECKPOINT_REQUIREMENT_UNCONFIGURED", "checkpoint requirement is not configured");
  }

  // 8. Cooldown, derived from the most recent settled attempt.
  if (latest) {
    if (latest.completedAt === null && latest.outcome === "in_progress") {
      // A different requestId while one is genuinely in flight: report progress
      // rather than starting a second provider call.
      return refuse("checking", "none");
    }
    if (latest.cooldownUntil && latest.cooldownUntil > now) {
      return refuse("cooldown", "cooldown_active", secondsUntil(latest.cooldownUntil, now));
    }
  }

  // 9. Rolling-hour allowance. Durable (row-derived) rather than in-memory, so
  // it survives a restart and cannot be reset by rotating processes.
  const windowStart = new Date(now.getTime() - config.rateLimitWindowSeconds * 1_000);
  const recent = await tx.checkpointVerificationAttempt.count({
    where: {
      enrollmentId: enrollment.id,
      levelDefinitionId: level.id,
      createdAt: { gt: windowStart },
    },
  });
  if (recent >= config.rateLimitAttempts) {
    const oldest = await tx.checkpointVerificationAttempt.findFirst({
      where: {
        enrollmentId: enrollment.id,
        levelDefinitionId: level.id,
        createdAt: { gt: windowStart },
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const freeAt = new Date(
      (oldest?.createdAt.getTime() ?? now.getTime()) + config.rateLimitWindowSeconds * 1_000,
    );
    return refuse("cooldown", "rate_limited", secondsUntil(freeAt, now));
  }

  // The claim. The unique index is what makes concurrent identical requests
  // resolve to ONE provider call: the loser of this insert re-reads the row.
  const attempt = await tx.checkpointVerificationAttempt.create({
    data: {
      enrollmentId: enrollment.id,
      levelDefinitionId: level.id,
      requestId,
      outcome: "in_progress",
      createdAt: now,
    },
    select: { id: true },
  });

  return {
    kind: "claimed",
    claim: {
      attemptId: attempt.id,
      enrollmentId: enrollment.id,
      levelDefinitionId: level.id,
      levelNumber: level.levelNumber,
      stableCode: level.stableCode,
      learnerId: actorUserId,
      integrationCode: requirement.integrationCode,
      thresholdMinorUnits: requirement.thresholdMinorUnits,
      maxLevel,
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Phase 3 — settle                                                          */
/* ------------------------------------------------------------------------ */

async function settle(
  tx: Prisma.TransactionClient,
  claimed: Claim,
  outcome: CheckpointVerificationOutcome,
  providerRequestId: string | null,
  observedAt: Date | null,
  now: Date,
  config: CheckpointVerificationConfig,
): Promise<CheckpointVerificationReceipt> {
  const cooldownUntil =
    outcome === "met" ? null : new Date(now.getTime() + config.cooldownSeconds * 1_000);

  // CAS on the claim: only the transition out of `in_progress` may settle, so a
  // duplicate settle can never rewrite an answered attempt.
  const settled = await tx.checkpointVerificationAttempt.updateMany({
    where: { id: claimed.attemptId, outcome: "in_progress", completedAt: null },
    data: { outcome, providerRequestId, observedAt, cooldownUntil, completedAt: now },
  });
  if (settled.count !== 1) {
    fail("CHECKPOINT_STATE_CORRUPT", "verification attempt was already settled");
  }

  const levelView = {
    levelNumber: claimed.levelNumber,
    stableCode: claimed.stableCode,
    maxLevel: claimed.maxLevel,
  };
  const attemptView = {
    id: claimed.attemptId,
    outcome,
    cooldownUntil,
    completedAt: now,
  };

  if (outcome !== "met") {
    // 14. Every non-met result: no completion, no currentLevel change, no XP.
    return receiptFrom(attemptView, levelView, now, { completed: false, replayed: false });
  }

  // 13. `met` is the only branch that touches progression, and it delegates:
  // `completeCurriculumLevel` remains the single progression owner. The
  // checkpoint engine creates the in_progress row the primitive requires and
  // hands over — it never writes `completed`, XP or currentLevel itself.
  const existingProgress = await tx.userLevelProgress.findFirst({
    where: { enrollmentId: claimed.enrollmentId, levelDefinitionId: claimed.levelDefinitionId },
    select: { id: true, status: true },
  });
  if (!existingProgress) {
    await tx.userLevelProgress.create({
      data: {
        enrollmentId: claimed.enrollmentId,
        curriculumVersionId: (
          await tx.levelDefinition.findUniqueOrThrow({
            where: { id: claimed.levelDefinitionId },
            select: { curriculumVersionId: true },
          })
        ).curriculumVersionId,
        levelDefinitionId: claimed.levelDefinitionId,
        status: "in_progress",
        startedAt: now,
        lastProgressAt: now,
        attemptCount: 0,
      },
    });
  }

  let completion;
  try {
    completion = await completeCurriculumLevelInTransaction(tx, {
      enrollmentId: claimed.enrollmentId,
      levelDefinitionId: claimed.levelDefinitionId,
      sourceType: "checkpoint_verification",
      sourceId: `checkpoint-verification:${claimed.attemptId}`,
      actorId: claimed.learnerId,
      evaluationTime: now,
    });
  } catch (error) {
    if (isCurriculumLevelCompletionError(error)) {
      // The whole transaction rolls back, including the settle above: a
      // verification that could not be recorded as a completion is not allowed
      // to leave a `met` attempt behind that nothing acted on.
      fail("CHECKPOINT_STATE_CORRUPT", `completion refused: ${error.code}`);
    }
    throw error;
  }
  if (completion.xpAwarded !== 0 || completion.xpTransactionId !== null) {
    fail("CHECKPOINT_STATE_CORRUPT", "financial checkpoint must award no XP");
  }

  await tx.auditLog.create({
    data: {
      userId: claimed.learnerId,
      action: CURRICULUM_AUDIT_ACTIONS.checkpointVerified,
      entityType: "CheckpointVerificationAttempt",
      entityId: String(claimed.attemptId),
      // Deliberately bounded: an identity, a verdict and a gate. No observed
      // amount, no provider payload, no account. The threshold is NOT recorded
      // either — it is public curriculum data, and repeating it per learner
      // would turn an audit trail into a financial profile.
      metadata: {
        enrollmentId: claimed.enrollmentId,
        levelDefinitionId: claimed.levelDefinitionId,
        levelNumber: claimed.levelNumber,
        stableCode: claimed.stableCode,
        integrationCode: claimed.integrationCode,
        outcome: "met",
        providerRequestId,
        attemptId: claimed.attemptId,
      },
    },
  });

  return receiptFrom(attemptView, levelView, now, { completed: true, replayed: false });
}

/* ------------------------------------------------------------------------ */
/* Command                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Verify the learner's current financial checkpoint.
 *
 * Throws `CheckpointVerificationError` for refusals that are the caller's
 * fault; returns a typed receipt or refusal for everything the learner is
 * simply not allowed to pass yet.
 */
export async function verifyCurrentCheckpoint({
  actorUserId,
  stableCode,
  requestId,
  evaluationTime,
  config: configOverrides,
  db = prisma,
  env = process.env,
}: VerifyCheckpointInput): Promise<VerifyCheckpointResult> {
  const config = resolvedConfig(configOverrides);
  const now = evaluationTime ?? new Date();

  // 6. requestId validity, before anything is read or written.
  if (typeof requestId !== "string" || !CHECKPOINT_REQUEST_ID_PATTERN.test(requestId)) {
    fail("CHECKPOINT_INPUT_INVALID", "requestId is invalid");
  }
  if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0) {
    fail("CHECKPOINT_INPUT_INVALID", "actor is invalid");
  }

  // 1. Flags and provider selection. A disabled or unwired provider is refused
  // HERE, before the database is touched, so a disabled checkpoint costs
  // nothing and can leave no trace.
  const resolution = resolveCheckpointProvider(env);
  if (!resolution.usable) {
    return refuse("verification_unavailable", resolution.reason);
  }

  let claimResult: ClaimResult | CheckpointVerificationRefusal;
  try {
    claimResult = await db.$transaction((tx) =>
      claim(tx, { actorUserId, stableCode, requestId, now, config }),
    );
  } catch (error) {
    // The loser of a concurrent identical claim: the unique index rejected the
    // insert, which means the winner is already calling the provider. Report
    // `checking` rather than racing it.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return refuse("checking", "none");
    }
    throw error;
  }
  if (claimResult.kind === "refused") return claimResult;
  if (claimResult.kind === "receipt") {
    return { kind: "receipt", ...claimResult.receipt };
  }

  const claimed = claimResult.claim;

  // 10 + 11. Exactly one provider call, bounded, never retried in-request.
  const result = await callCheckpointProvider(
    resolution.provider,
    {
      learnerId: claimed.learnerId,
      enrollmentId: claimed.enrollmentId,
      levelDefinitionId: claimed.levelDefinitionId,
      integrationCode: claimed.integrationCode,
      thresholdCurrency: "USD",
      thresholdMinorUnits: claimed.thresholdMinorUnits,
      requestId,
    },
    config.providerTimeoutMs,
  );

  const outcome = durableOutcome(result);
  const settleTime = new Date();

  // 12 + 13. Persist the typed attempt, and complete only on `met`.
  const receipt = await db.$transaction((tx) =>
    settle(
      tx,
      claimed,
      outcome,
      result.providerRequestId ?? null,
      result.observedAt ?? null,
      settleTime,
      config,
    ),
  );

  // Provider back-pressure is surfaced when it exceeds our own cooldown; the
  // learner is told the longer of the two waits rather than a wait we know is
  // too short.
  const providerRetry = result.retryAfterSeconds ?? null;
  if (providerRetry !== null && (receipt.retryAfterSeconds ?? 0) < providerRetry) {
    return { kind: "receipt", ...receipt, retryAfterSeconds: providerRetry };
  }
  return { kind: "receipt", ...receipt };
}
