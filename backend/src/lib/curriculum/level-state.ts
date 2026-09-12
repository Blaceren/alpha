import {
  Prisma,
  type CurriculumVersion,
  type LevelDefinition,
  type ModuleDefinition,
  type PrismaClient,
  type UserCurriculumEnrollment,
  type UserLevelProgress,
} from "@prisma/client";
import {
  isCurriculumV2EnrollmentEnabled,
  isCurriculumV2ReadEnabled,
} from "@/lib/env";
import { emitLevelStartedEvent } from "@/lib/growth/product-events";
import { prisma } from "@/lib/prisma";
import {
  isFinancialCheckpointType,
  resolveCheckpointVerification,
  type CheckpointAttemptSnapshot,
  type CheckpointReadModel,
  type CheckpointRequirementSnapshot,
} from "./checkpoint";
import { CURRICULUM_AUDIT_ACTIONS } from "./constants";
import {
  resolveUserCurriculumContext,
  type ResolvedProgress,
  type SafeResolverDiagnostics,
  type UserCurriculumContextResult,
} from "./resolver";
import { resolveEnrollmentXp } from "./xp";

export type EffectiveLevelState =
  | "completed"
  | "pending_review"
  | "in_progress"
  | "available"
  | "xp_eligible"
  // A financial checkpoint the learner has reached but that the platform cannot
  // verify. Derived read-model state only: no UserLevelProgress status is added
  // for it, and no durable row changes when a level presents this way. It is
  // NOT `available` (nothing can be started) and NOT `locked` (the learner has
  // legitimately arrived, and the sequence in front of it is complete).
  | "checkpoint_unverified"
  | "locked";

export type LevelStateBlockerCode =
  | "not_current_level"
  | "sequence_incomplete"
  | "definition_inactive"
  | "xp_engine_unavailable"
  | "xp_insufficient"
  // A level that DEPENDS on a checkpoint cannot be evaluated.
  | "checkpoint_engine_unavailable"
  // The checkpoint level ITSELF cannot be verified: no authoritative balance
  // authority exists. Distinct from the blocker above, which is about a
  // dependency rather than about the gate.
  | "checkpoint_verification_unavailable"
  // The gate CAN be verified and the learner is standing at it, but the
  // threshold has not been met yet. Distinct from the blocker above: one says
  // the platform cannot look, this one says it looked (or can) and the answer
  // is not yet yes.
  | "checkpoint_verification_required"
  | "visibility_rule_unsupported";

export type EffectiveLevelStateItem = {
  levelDefinition: LevelDefinition;
  moduleDefinition: ModuleDefinition;
  progress: ResolvedProgress | null;
  state: EffectiveLevelState;
  blockers: LevelStateBlockerCode[];
  /** Present only on `financial_checkpoint` levels; never carries a balance. */
  checkpoint: CheckpointReadModel | null;
};

// Safe internal XP summary (never duplicated per level; each level exposes only
// its own requiredXp/presentationState/blockers). Not part of the HTTP contract.
export type LevelStateXpSummary =
  | { kind: "disabled" }
  | {
      kind: "available";
      totalXp: number;
      transactionCount: number;
      lastTransactionAt: Date | null;
    };

export type LevelStateCorruptReason =
  | "invalid_level_sequence"
  | "invalid_summary_progress"
  | "invalid_progress_timestamps"
  | "multiple_available_levels"
  | "xp_enrollment_missing"
  | "xp_resolution_corrupt"
  | "xp_snapshot_mismatch"
  | "xp_total_out_of_range";

// Blockers that a satisfied XP threshold does not clear but which still leave a
// structurally-sound future level presentable as xp_eligible.
const XP_ELIGIBLE_REMAINING_BLOCKERS = new Set<LevelStateBlockerCode>([
  "not_current_level",
  "sequence_incomplete",
]);

type ResolvedLevelStateContext = {
  kind: "resolved";
  userId: number;
  enrollment: UserCurriculumEnrollment;
  curriculumVersion: CurriculumVersion;
  modules: ModuleDefinition[];
  levels: EffectiveLevelStateItem[];
  xp: LevelStateXpSummary;
};

type LevelStateCommandDb = Prisma.TransactionClient;

export type UserCurriculumLevelStatesResult =
  | { kind: "disabled" }
  | { kind: "user_not_found" }
  | {
      kind: "unavailable";
      reason:
        | "no_active_enrollment"
        | "enrollment_completed"
        | "curriculum_unavailable";
    }
  | {
      kind: "corrupt";
      reason: string;
      diagnostics: SafeResolverDiagnostics;
    }
  | ResolvedLevelStateContext;

export type ResolveUserCurriculumLevelStatesInput = {
  userId: number;
  asOf?: Date;
  // When a transaction client is supplied (e.g. the lazy-start command), it is
  // used directly and no nested transaction is opened. When omitted, the whole
  // curriculum/progress/XP read runs inside one snapshot transaction.
  db?: LevelStateCommandDb;
};

function corruptLevelState(
  reason: string,
  diagnostics: SafeResolverDiagnostics,
): Extract<UserCurriculumLevelStatesResult, { kind: "corrupt" }> {
  return { kind: "corrupt", reason, diagnostics };
}

/**
 * Durable checkpoint facts, read once per resolution and keyed by level id.
 *
 * Carries only a configured threshold and a typed attempt outcome — the two
 * snapshot types have no field an observed balance could occupy, so widening
 * the read model with them cannot widen what a learner can see about money.
 */
export type CheckpointStateSnapshots = {
  requirements: Map<number, CheckpointRequirementSnapshot>;
  latestAttempts: Map<number, CheckpointAttemptSnapshot>;
};

const EMPTY_CHECKPOINT_SNAPSHOTS: CheckpointStateSnapshots = {
  requirements: new Map(),
  latestAttempts: new Map(),
};

function deriveEnrolledLevelStates(
  context: Extract<UserCurriculumContextResult, { kind: "enrolled" }>,
  xp: LevelStateXpSummary,
  checkpoints: CheckpointStateSnapshots = EMPTY_CHECKPOINT_SNAPSHOTS,
  evaluationTime: Date = new Date(),
): UserCurriculumLevelStatesResult {
  const xpEnabled = xp.kind === "available";
  const currentXp = xp.kind === "available" ? xp.totalXp : 0;
  const modules = [...context.modules].sort(
    (left, right) => left.moduleNumber - right.moduleNumber || left.id - right.id,
  );
  const definitions = [...context.levels].sort(
    (left, right) => left.levelNumber - right.levelNumber || left.id - right.id,
  );
  const moduleById = new Map(modules.map((moduleDefinition) => [moduleDefinition.id, moduleDefinition]));

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const expectedNumber = index + 1;
    const expectedPrevious = expectedNumber === 1 ? null : expectedNumber - 1;
    if (
      definition.levelNumber !== expectedNumber ||
      definition.requiredPreviousLevel !== expectedPrevious ||
      !moduleById.has(definition.moduleId)
    ) {
      return corruptLevelState("invalid_level_sequence", {
        enrollmentId: context.enrollment.id,
        versionId: context.curriculumVersion.id,
        levelDefinitionId: definition.id,
        levelNumber: definition.levelNumber,
      });
    }
  }

  const currentDefinition = definitions.find(
    (definition) => definition.levelNumber === context.enrollment.currentLevel,
  );
  if (!currentDefinition) {
    return corruptLevelState("invalid_level_sequence", {
      enrollmentId: context.enrollment.id,
      currentLevel: context.enrollment.currentLevel,
      levelCount: definitions.length,
    });
  }

  const progressByLevelId = new Map<number, ResolvedProgress>();
  const completedNumbers = new Set<number>();
  let maximumCompleted = 0;

  for (const progress of context.progress) {
    const levelNumber = progress.levelDefinition.levelNumber;
    progressByLevelId.set(progress.levelDefinitionId, progress);

    if (
      progress.attemptCount < 0 ||
      (progress.status === "completed" && !progress.completedAt) ||
      (progress.status !== "completed" && progress.completedAt)
    ) {
      return corruptLevelState("invalid_progress_timestamps", {
        enrollmentId: context.enrollment.id,
        progressId: progress.id,
        levelNumber,
        status: String(progress.status),
      });
    }

    if (progress.status === "completed") {
      if (levelNumber >= context.enrollment.currentLevel) {
        return corruptLevelState("invalid_summary_progress", {
          enrollmentId: context.enrollment.id,
          progressId: progress.id,
          issue: "completed_at_or_after_current_level",
          levelNumber,
          currentLevel: context.enrollment.currentLevel,
        });
      }
      completedNumbers.add(levelNumber);
      maximumCompleted = Math.max(maximumCompleted, levelNumber);
    } else if (levelNumber !== context.enrollment.currentLevel) {
      return corruptLevelState("invalid_summary_progress", {
        enrollmentId: context.enrollment.id,
        progressId: progress.id,
        issue: "non_current_active_progress",
        levelNumber,
        currentLevel: context.enrollment.currentLevel,
      });
    }
  }

  for (let levelNumber = 1; levelNumber <= maximumCompleted; levelNumber += 1) {
    if (!completedNumbers.has(levelNumber)) {
      return corruptLevelState("invalid_summary_progress", {
        enrollmentId: context.enrollment.id,
        issue: "completed_sequence_gap",
        levelNumber,
      });
    }
  }

  if (
    context.enrollment.highestCompletedLevel !== maximumCompleted ||
    context.enrollment.highestCompletedLevel >= context.enrollment.currentLevel
  ) {
    return corruptLevelState("invalid_summary_progress", {
      enrollmentId: context.enrollment.id,
      highestCompletedLevel: context.enrollment.highestCompletedLevel,
      maximumCompleted,
      currentLevel: context.enrollment.currentLevel,
    });
  }

  /**
   * The lowest level number that is NOT completed.
   *
   * The blocker below used to be decided by re-walking every earlier level for
   * every level — O(n²) over a 100-level curriculum, on the hot read path that
   * `/current`, the level-start owner and every completion share. This is the
   * same predicate computed once.
   *
   * Equivalence, by definition rather than by invariant: a level L was blocked
   * exactly when some `previous` in [1, L) was absent from `completedNumbers`,
   * and such a `previous` exists exactly when the SMALLEST absent number is
   * below L. So `firstIncompleteLevel < L` is the same test, level for level.
   *
   * Deliberately NOT derived from `maximumCompleted` or `highestCompletedLevel`:
   * those are equal to this value minus one only because the contiguity and
   * summary checks above already passed. Scanning for the first hole keeps this
   * correct on its own terms, so a future change to those checks cannot silently
   * change the unlock policy.
   *
   * The scan stops at the first hole, so it costs O(completed) once, not O(n)
   * per level. `definitions.length` bounds it: `completedNumbers` only ever
   * holds level numbers that exist.
   */
  let firstIncompleteLevel = 1;
  while (completedNumbers.has(firstIncompleteLevel)) {
    firstIncompleteLevel += 1;
  }

  const levels: EffectiveLevelStateItem[] = definitions.map((levelDefinition) => {
    const moduleDefinition = moduleById.get(levelDefinition.moduleId)!;
    const progress = progressByLevelId.get(levelDefinition.id) ?? null;
    // A financial checkpoint is governed by an external authority, so it is
    // resolved before the ordinary progress/blocker path. The checkpoint read
    // model is definition- and flag-derived only; it never touches progress and
    // never carries a financial value.
    const isCheckpoint = isFinancialCheckpointType(levelDefinition.type);
    /**
     * Structurally standing AT the gate: this is the current level, everything
     * before it is complete, and the definition is live. A learner who has not
     * arrived is never offered verification, so `canVerify` cannot be true for
     * a level they cannot reach.
     */
    const atGate =
      levelDefinition.levelNumber === context.enrollment.currentLevel &&
      levelDefinition.status === "active" &&
      moduleDefinition.status === "active" &&
      context.enrollment.highestCompletedLevel === levelDefinition.levelNumber - 1;
    const checkpointFor = (completed: boolean) =>
      isCheckpoint
        ? resolveCheckpointVerification({
            integrationCode: levelDefinition.featureUnlockCode,
            requirement: checkpoints.requirements.get(levelDefinition.id) ?? null,
            latestAttempt: checkpoints.latestAttempts.get(levelDefinition.id) ?? null,
            completed,
            reachable: atGate,
            now: evaluationTime,
          })
        : null;

    if (progress) {
      const checkpoint = checkpointFor(progress.status === "completed");
      // A checkpoint completed by a future verification engine stays completed;
      // any other durable status presents as unverified rather than as an
      // ordinary in-progress learning level. The durable row is not modified —
      // only how it reads.
      if (isCheckpoint && progress.status !== "completed") {
        return {
          levelDefinition,
          moduleDefinition,
          progress,
          state: "checkpoint_unverified",
          blockers: [
            checkpoint?.canVerify
              ? "checkpoint_verification_required"
              : "checkpoint_verification_unavailable",
          ],
          checkpoint,
        };
      }
      return {
        levelDefinition,
        moduleDefinition,
        progress,
        state: progress.status,
        blockers: [],
        checkpoint,
      };
    }

    const blockers: LevelStateBlockerCode[] = [];
    if (levelDefinition.levelNumber !== context.enrollment.currentLevel) {
      blockers.push("not_current_level");
    }
    if (
      levelDefinition.status !== "active" ||
      moduleDefinition.status !== "active"
    ) {
      blockers.push("definition_inactive");
    }
    // O(1). Same predicate as the removed inner scan: "some earlier level is
    // not completed" <-> "the first incomplete level precedes this one".
    if (firstIncompleteLevel < levelDefinition.levelNumber) {
      blockers.push("sequence_incomplete");
    }
    // XP gate uses only the V2 ledger authority. requiredXp === 0 always passes.
    // Fail closed when the engine is unavailable; only report insufficiency when
    // the engine is available and the pinned total is below the threshold.
    const xpThresholdMet =
      levelDefinition.requiredXp === 0 ||
      (xpEnabled && currentXp >= levelDefinition.requiredXp);
    if (levelDefinition.requiredXp > 0) {
      if (!xpEnabled) {
        blockers.push("xp_engine_unavailable");
      } else if (currentXp < levelDefinition.requiredXp) {
        blockers.push("xp_insufficient");
      }
    }
    if (levelDefinition.requiredCheckpointLevel !== null) {
      blockers.push("checkpoint_engine_unavailable");
    }
    if (levelDefinition.visibilityRule !== null) {
      blockers.push("visibility_rule_unsupported");
    }
    // The checkpoint gate itself. Recorded before the state is chosen so a
    // checkpoint can never fall through to `available`, and so the blocker is
    // visible even when the level is locked for an unrelated reason.
    const structurallyReachable = blockers.length === 0;
    const checkpoint = checkpointFor(false);
    if (isCheckpoint) {
      // Two different facts, never conflated: "the platform cannot look" and
      // "the platform can look, you have not passed yet". Reporting the first
      // when the second is true would be the same dishonesty in reverse that
      // the honest gate exists to prevent.
      blockers.push(
        checkpoint?.canVerify
          ? "checkpoint_verification_required"
          : "checkpoint_verification_unavailable",
      );
    }

    let state: EffectiveLevelState;
    if (isCheckpoint) {
      // Reached and sequence-complete -> the learner is legitimately standing at
      // the gate (`checkpoint_unverified`). Otherwise the ordinary lock applies.
      // XP never opens a checkpoint (DD-030), so `xp_eligible` is not reachable
      // here.
      state = structurallyReachable ? "checkpoint_unverified" : "locked";
    } else if (blockers.length === 0) {
      state = "available";
    } else if (
      xpEnabled &&
      xpThresholdMet &&
      blockers.every((blocker) => XP_ELIGIBLE_REMAINING_BLOCKERS.has(blocker))
    ) {
      // XP threshold satisfied and structurally sound (active definition,
      // supported visibility, no checkpoint gate); still not startable because
      // of sequence/current-level. XP never removes a checkpoint/inactive/
      // visibility blocker, so those keep the level locked instead.
      state = "xp_eligible";
    } else {
      state = "locked";
    }

    return {
      levelDefinition,
      moduleDefinition,
      progress,
      state,
      blockers,
      checkpoint,
    };
  });

  const available = levels.filter((level) => level.state === "available");
  if (available.length > 1) {
    return corruptLevelState("multiple_available_levels", {
      enrollmentId: context.enrollment.id,
      levelDefinitionIds: available.map((level) => level.levelDefinition.id),
    });
  }

  return {
    kind: "resolved",
    userId: context.userId,
    enrollment: context.enrollment,
    curriculumVersion: context.curriculumVersion,
    modules,
    levels,
    xp,
  };
}

async function resolveLevelStatesWithin(
  client: LevelStateCommandDb,
  userId: number,
  evaluationTime: Date,
): Promise<UserCurriculumLevelStatesResult> {
  const context = await resolveUserCurriculumContext({
    userId,
    asOf: evaluationTime,
    db: client,
  });
  if (context.kind === "disabled") return context;
  if (context.kind === "user_not_found") return context;
  if (context.kind === "corrupt") return context;
  if (context.kind === "completed") {
    return { kind: "unavailable", reason: "enrollment_completed" };
  }
  if (context.kind === "unavailable") {
    return { kind: "unavailable", reason: "curriculum_unavailable" };
  }
  if (context.kind !== "enrolled") {
    return { kind: "unavailable", reason: "no_active_enrollment" };
  }

  // Resolve XP exactly once per enrollment, on the same snapshot client, and
  // treat any raw XP failure as whole-result corruption rather than a partially
  // plausible level map.
  const rawXp = await resolveEnrollmentXp({
    enrollmentId: context.enrollment.id,
    asOf: evaluationTime,
    db: client,
  });
  if (rawXp.kind === "not_found") {
    return corruptLevelState("xp_enrollment_missing", {
      enrollmentId: context.enrollment.id,
      versionId: context.curriculumVersion.id,
    });
  }
  if (rawXp.kind === "corrupt") {
    return corruptLevelState("xp_resolution_corrupt", {
      enrollmentId: context.enrollment.id,
      versionId: context.curriculumVersion.id,
      xpReason: rawXp.reason,
    });
  }

  let xpSummary: LevelStateXpSummary;
  if (rawXp.kind === "available") {
    if (
      rawXp.enrollmentId !== context.enrollment.id ||
      rawXp.curriculumVersion.id !== context.curriculumVersion.id
    ) {
      return corruptLevelState("xp_snapshot_mismatch", {
        enrollmentId: context.enrollment.id,
        versionId: context.curriculumVersion.id,
      });
    }
    if (!Number.isSafeInteger(rawXp.totalXp) || rawXp.totalXp < 0) {
      return corruptLevelState("xp_total_out_of_range", {
        enrollmentId: context.enrollment.id,
        versionId: context.curriculumVersion.id,
      });
    }
    xpSummary = {
      kind: "available",
      totalXp: rawXp.totalXp,
      transactionCount: rawXp.transactionCount,
      lastTransactionAt: rawXp.lastTransactionAt,
    };
  } else {
    xpSummary = { kind: "disabled" };
  }

  const checkpoints = await loadCheckpointSnapshots(client, context);
  return deriveEnrolledLevelStates(context, xpSummary, checkpoints, evaluationTime);
}

/**
 * Load the durable checkpoint facts for this enrollment, on the same read
 * snapshot as everything else.
 *
 * Two bounded queries and only for levels that ARE financial checkpoints — a
 * curriculum with no checkpoint touches neither new table. The selected columns
 * are an explicit allow-list, so a future column on either table cannot reach
 * the read model by being added.
 */
async function loadCheckpointSnapshots(
  client: LevelStateCommandDb,
  context: Extract<UserCurriculumContextResult, { kind: "enrolled" }>,
): Promise<CheckpointStateSnapshots> {
  const checkpointLevelIds = context.levels
    .filter((level) => isFinancialCheckpointType(level.type))
    .map((level) => level.id);
  if (checkpointLevelIds.length === 0) return EMPTY_CHECKPOINT_SNAPSHOTS;

  const requirementRows = await client.levelCheckpointRequirement.findMany({
    where: { levelDefinitionId: { in: checkpointLevelIds } },
    select: {
      levelDefinitionId: true,
      integrationCode: true,
      thresholdCurrency: true,
      thresholdMinorUnits: true,
    },
  });
  const attemptRows = await client.checkpointVerificationAttempt.findMany({
    where: {
      enrollmentId: context.enrollment.id,
      levelDefinitionId: { in: checkpointLevelIds },
    },
    orderBy: { id: "desc" },
    select: {
      levelDefinitionId: true,
      outcome: true,
      cooldownUntil: true,
      completedAt: true,
    },
  });

  const latestAttempts = new Map<number, CheckpointAttemptSnapshot>();
  for (const row of attemptRows) {
    // Rows arrive newest-first; the first per level is the latest.
    if (latestAttempts.has(row.levelDefinitionId)) continue;
    latestAttempts.set(row.levelDefinitionId, {
      outcome: row.outcome,
      cooldownUntil: row.cooldownUntil,
      completedAt: row.completedAt,
    });
  }

  return {
    requirements: new Map(
      requirementRows.map((row) => [
        row.levelDefinitionId,
        {
          integrationCode: row.integrationCode,
          thresholdCurrency: row.thresholdCurrency,
          thresholdMinorUnits: row.thresholdMinorUnits,
        },
      ]),
    ),
    latestAttempts,
  };
}

export async function resolveUserCurriculumLevelStates({
  userId,
  asOf,
  db,
}: ResolveUserCurriculumLevelStatesInput): Promise<UserCurriculumLevelStatesResult> {
  if (!isCurriculumV2ReadEnabled()) return { kind: "disabled" };
  const evaluationTime = asOf ?? new Date();

  // A supplied transaction client is used directly (no nested transaction).
  // Otherwise open one read snapshot so curriculum, progress and XP are read
  // from a single consistent boundary. The resolver only reads.
  if (db) return resolveLevelStatesWithin(db, userId, evaluationTime);
  return prisma.$transaction((tx) =>
    resolveLevelStatesWithin(tx, userId, evaluationTime),
  );
}

export type LevelStartDomainErrorCode =
  | "LEVEL_START_DISABLED"
  | "CURRICULUM_READ_DISABLED"
  | "LEVEL_START_USER_NOT_FOUND"
  | "LEVEL_START_USER_INACTIVE"
  | "LEVEL_START_NO_ACTIVE_ENROLLMENT"
  | "LEVEL_START_ENROLLMENT_COMPLETED"
  | "LEVEL_STATE_CORRUPT"
  | "LEVEL_START_NOT_AVAILABLE"
  // The four codes below exist only for callers that name a target level (see
  // `expectedStableCode`). They are raised before any write, so a learner who
  // asks for the wrong level changes nothing at all.
  | "LEVEL_START_LEVEL_NOT_FOUND"
  | "LEVEL_START_NOT_CURRENT"
  | "LEVEL_START_ALREADY_COMPLETED"
  | "LEVEL_START_LOCKED"
  // A financial checkpoint is never started like a learning level: it is
  // resolved by an external authority. Typed separately from
  // LEVEL_START_NOT_AVAILABLE so "this gate cannot be verified" is never
  // mistaken for "you have not got here yet".
  | "LEVEL_START_CHECKPOINT_UNVERIFIED";

export class LevelStartDomainError extends Error {
  readonly code: LevelStartDomainErrorCode;
  readonly blockers: LevelStateBlockerCode[];

  constructor(
    code: LevelStartDomainErrorCode,
    message: string,
    blockers: LevelStateBlockerCode[] = [],
  ) {
    super(message);
    this.name = "LevelStartDomainError";
    this.code = code;
    this.blockers = blockers;
  }
}

export function isLevelStartDomainError(error: unknown): error is LevelStartDomainError {
  return error instanceof LevelStartDomainError;
}

export type LevelStartCommandDb = Pick<PrismaClient, "$transaction">;

export type StartCurrentCurriculumLevelInput = {
  actorUserId: number;
  asOf?: Date;
  db?: LevelStartCommandDb;
  /**
   * The level the caller believes it is starting.
   *
   * This is a GUARD, never a selector. There is deliberately no way to nominate
   * which level gets started — this owner starts the learner's current level and
   * nothing else. Supplying a stable code only asks the owner to refuse, without
   * writing anything, if that is not the level it was about to start.
   *
   * It exists because an HTTP caller is working from a page that may be stale.
   * Checking inside this transaction rather than in the caller is what makes
   * "asking for a locked level mutates nothing" true: a check outside would read
   * one snapshot, then start whatever became current a moment later.
   *
   * Omitted by trusted server-side callers, which have no page to be stale.
   */
  expectedStableCode?: string;
};

export type StartCurrentCurriculumLevelResult = {
  kind: "started";
  created: boolean;
  enrollment: UserCurriculumEnrollment;
  levelDefinition: LevelDefinition;
  progress: UserLevelProgress;
};

function mapLevelStateFailure(
  result: Exclude<UserCurriculumLevelStatesResult, ResolvedLevelStateContext>,
): never {
  if (result.kind === "disabled") {
    throw new LevelStartDomainError(
      "CURRICULUM_READ_DISABLED",
      "curriculum read resolver is disabled",
    );
  }
  if (result.kind === "user_not_found") {
    throw new LevelStartDomainError(
      "LEVEL_START_USER_NOT_FOUND",
      "level start user does not exist",
    );
  }
  if (result.kind === "corrupt") {
    throw new LevelStartDomainError(
      "LEVEL_STATE_CORRUPT",
      `ata-v2 level state is corrupt: ${result.reason}`,
    );
  }
  if (result.reason === "enrollment_completed") {
    throw new LevelStartDomainError(
      "LEVEL_START_ENROLLMENT_COMPLETED",
      "completed enrollment cannot start another level",
    );
  }
  throw new LevelStartDomainError(
    "LEVEL_START_NO_ACTIVE_ENROLLMENT",
    "active ata-v2 enrollment is required",
  );
}

function currentState(result: ResolvedLevelStateContext): EffectiveLevelStateItem {
  const state = result.levels.find(
    (level) => level.levelDefinition.levelNumber === result.enrollment.currentLevel,
  );
  if (!state) {
    throw new LevelStartDomainError(
      "LEVEL_STATE_CORRUPT",
      "current level definition is missing",
    );
  }
  return state;
}

async function loadStartState(
  tx: Prisma.TransactionClient,
  actorUserId: number,
  evaluationTime: Date,
) {
  const user = await tx.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, status: true },
  });
  if (!user) {
    throw new LevelStartDomainError(
      "LEVEL_START_USER_NOT_FOUND",
      "level start user does not exist",
    );
  }
  if (user.status !== "active") {
    throw new LevelStartDomainError(
      "LEVEL_START_USER_INACTIVE",
      "level start user is not active",
    );
  }

  const result = await resolveUserCurriculumLevelStates({
    userId: user.id,
    asOf: evaluationTime,
    db: tx,
  });
  if (result.kind !== "resolved") mapLevelStateFailure(result);
  return { result, state: currentState(result) };
}

/**
 * Refuse, before any write, when the caller named a level this owner was not
 * about to start.
 *
 * The distinctions matter to the learner: "that level does not exist" and "you
 * finished that one already" and "that one is still locked" are three different
 * facts, and collapsing them into one refusal would make a stale Academy page
 * indistinguishable from a bypass attempt.
 *
 * A completed or locked level is by construction never the current level, so
 * those branches are only reachable through the mismatch path.
 */
function assertExpectedStartTarget(
  result: ResolvedLevelStateContext,
  expectedStableCode: string,
): void {
  const target = result.levels.find(
    (level) => level.levelDefinition.stableCode === expectedStableCode,
  );
  if (!target) {
    throw new LevelStartDomainError(
      "LEVEL_START_LEVEL_NOT_FOUND",
      "named level is not part of the active curriculum",
    );
  }
  if (target.levelDefinition.levelNumber === result.enrollment.currentLevel) {
    return;
  }
  if (target.state === "completed") {
    throw new LevelStartDomainError(
      "LEVEL_START_ALREADY_COMPLETED",
      "named level is already completed",
      target.blockers,
    );
  }
  if (target.state === "locked") {
    throw new LevelStartDomainError(
      "LEVEL_START_LOCKED",
      "named level is locked",
      target.blockers,
    );
  }
  throw new LevelStartDomainError(
    "LEVEL_START_NOT_CURRENT",
    "named level is not the current level",
    target.blockers,
  );
}

/**
 * PHASE-1 ADMIN — the trusted context an administrative correction passes in.
 *
 * ONE narrowly-scoped parameter, and it exists because of a specific falsehood.
 * When an administrative correction reaches a level the learner never opened, it
 * has to materialise the progress row through this owner — writing one directly
 * would be a second progress implementation. But the owner's `level_started`
 * growth event means "a learner opened this level", and an operator creating the
 * row is not that. Emitting it would put an organic learner-behaviour event into
 * the funnel for something no learner did, which is exactly what the
 * administrative-analytics rule forbids.
 *
 * It changes TWO things and nothing else: growth events are not emitted, and the
 * audit row is attributed to the OPERATOR and marked administrative, so the
 * durable record does not say the learner started a level they never opened.
 * When absent — every ordinary learner start — this file behaves exactly as it
 * did, which is why the parameter is optional rather than a mode.
 */
export type AdministrativeStartContext = {
  /** The operator, for the audit row. Never the learner. */
  readonly actorUserId: number;
  readonly actorStaffProfileId: string;
  readonly reasonCode: string;
  readonly requestIdHash: string;
};

async function runStartTransaction(
  tx: Prisma.TransactionClient,
  actorUserId: number,
  evaluationTime: Date,
  expectedStableCode?: string,
  administrative?: AdministrativeStartContext,
): Promise<StartCurrentCurriculumLevelResult> {
  const { result, state } = await loadStartState(
    tx,
    actorUserId,
    evaluationTime,
  );

  // Before every other refusal, and before every write: an untrusted caller that
  // named the wrong level must leave no trace whatsoever.
  if (expectedStableCode !== undefined) {
    assertExpectedStartTarget(result, expectedStableCode);
  }

  // A financial checkpoint is refused before anything else, with or without an
  // existing progress row: it is not a learning level, it cannot be started,
  // and no progress may be created that would imply the learner is working on
  // it. Refusing here also means no row is written that a later verification
  // engine would have to reconcile.
  if (isFinancialCheckpointType(state.levelDefinition.type)) {
    throw new LevelStartDomainError(
      "LEVEL_START_CHECKPOINT_UNVERIFIED",
      "financial checkpoint verification is unavailable",
      state.blockers,
    );
  }
  if (
    state.progress &&
    (state.state === "in_progress" || state.state === "pending_review")
  ) {
    return {
      kind: "started",
      created: false,
      enrollment: result.enrollment,
      levelDefinition: state.levelDefinition,
      progress: state.progress,
    };
  }
  if (state.state !== "available") {
    throw new LevelStartDomainError(
      "LEVEL_START_NOT_AVAILABLE",
      "current ata-v2 level is not available",
      state.blockers,
    );
  }

  const progress = await tx.userLevelProgress.create({
    data: {
      enrollmentId: result.enrollment.id,
      curriculumVersionId: result.curriculumVersion.id,
      levelDefinitionId: state.levelDefinition.id,
      status: "in_progress",
      startedAt: evaluationTime,
      lastProgressAt: evaluationTime,
      attemptCount: 0,
    },
  });

  // G4-GROWTH — the level-started step of the CRO funnel.
  //
  // This is the only place a `UserLevelProgress` row is created by a learner
  // action, so it is the only place a level genuinely starts. The other two
  // creators — checkpoint verification and staging attestation — create progress
  // for an operator-driven path and are covered by the completion hook instead.
  // PHASE-1 ADMIN — an administratively materialised row emits nothing. Nobody
  // opened this level, so the funnel is not told that anybody did.
  if (!administrative) {
    await emitLevelStartedEvent(tx, {
      userLevelProgressId: progress.id,
      enrollmentId: result.enrollment.id,
      userId: result.enrollment.userId,
      levelDefinitionId: state.levelDefinition.id,
      levelNumber: state.levelDefinition.levelNumber,
      occurredAt: evaluationTime,
    });
  }

  const enrollment = await tx.userCurriculumEnrollment.update({
    where: { id: result.enrollment.id },
    data: { lastMeaningfulActionAt: evaluationTime },
  });

  await tx.auditLog.create({
    data: {
      // Attributed to the OPERATOR on an administrative start. Recording the
      // learner as the actor would be the same falsehood the growth suppression
      // above avoids, written somewhere more durable.
      userId: administrative ? administrative.actorUserId : actorUserId,
      action: CURRICULUM_AUDIT_ACTIONS.levelStarted,
      entityType: "UserLevelProgress",
      entityId: String(progress.id),
      metadata: {
        actorUserId: administrative ? administrative.actorUserId : actorUserId,
        userId: actorUserId,
        enrollmentId: enrollment.id,
        curriculumVersionId: result.curriculumVersion.id,
        levelDefinitionId: state.levelDefinition.id,
        levelNumber: state.levelDefinition.levelNumber,
        stableCode: state.levelDefinition.stableCode,
        // Present only on an administrative start, so its ABSENCE is the
        // statement that a learner opened this level themselves.
        ...(administrative
          ? {
              administrative: {
                reasonCode: administrative.reasonCode,
                actorStaffProfileId: administrative.actorStaffProfileId,
                requestIdHash: administrative.requestIdHash,
              },
            }
          : {}),
      },
    },
  });

  return {
    kind: "started",
    created: true,
    enrollment,
    levelDefinition: state.levelDefinition,
    progress,
  };
}

function isPrismaUniqueConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

async function recoverConcurrentStart(
  db: LevelStartCommandDb,
  actorUserId: number,
  evaluationTime: Date,
  expectedStableCode?: string,
): Promise<StartCurrentCurriculumLevelResult | null> {
  return db.$transaction(async (tx) => {
    const { result, state } = await loadStartState(
      tx,
      actorUserId,
      evaluationTime,
    );
    if (expectedStableCode !== undefined) {
      assertExpectedStartTarget(result, expectedStableCode);
    }
    if (
      !state.progress ||
      (state.state !== "in_progress" && state.state !== "pending_review")
    ) {
      return null;
    }
    return {
      kind: "started",
      created: false,
      enrollment: result.enrollment,
      levelDefinition: state.levelDefinition,
      progress: state.progress,
    };
  });
}

/**
 * PHASE-1 ADMIN — the same start owner, inside a caller's transaction.
 *
 * WHY THIS EXISTS. `startCurrentCurriculumLevel` opens its own transaction, so
 * a coordinator that must complete SEVERAL levels atomically cannot use it: a
 * Prisma `TransactionClient` has no `$transaction`, and an administrative
 * multi-level correction is required to be all-or-nothing. The alternative was
 * for the coordinator to insert its own `UserLevelProgress` row, which is a
 * second progress implementation and exactly what this domain has spent several
 * phases removing.
 *
 * So the body is shared verbatim — this is the identical `runStartTransaction`
 * the public command runs, with the identical flag gates — and only the
 * transaction boundary differs. It follows `completeCurriculumLevelInTransaction`
 * and `enrollActiveCurriculumForNewUserInTransaction`, which exist for the same
 * reason.
 *
 * NO CONCURRENT-START RECOVERY HERE, deliberately. The public command recovers
 * from a losing unique conflict because a learner double-clicking should still
 * end up started. Inside an administrative correction a unique conflict means
 * the learner acted while the operator was deciding — the operator's view is
 * stale, and the correct answer is to roll the whole adjustment back and make
 * them look again, not to absorb the race and carry on.
 */
export async function startCurrentCurriculumLevelInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: number;
    asOf?: Date;
    expectedStableCode?: string;
    administrative?: AdministrativeStartContext;
  },
): Promise<StartCurrentCurriculumLevelResult> {
  if (!isCurriculumV2EnrollmentEnabled()) {
    throw new LevelStartDomainError(
      "LEVEL_START_DISABLED",
      "curriculum level start is disabled",
    );
  }
  if (!isCurriculumV2ReadEnabled()) {
    throw new LevelStartDomainError(
      "CURRICULUM_READ_DISABLED",
      "curriculum read resolver is disabled",
    );
  }
  return runStartTransaction(
    tx,
    input.actorUserId,
    input.asOf ?? new Date(),
    input.expectedStableCode,
    input.administrative,
  );
}

export async function startCurrentCurriculumLevel({
  actorUserId,
  asOf,
  db = prisma,
  expectedStableCode,
}: StartCurrentCurriculumLevelInput): Promise<StartCurrentCurriculumLevelResult> {
  if (!isCurriculumV2EnrollmentEnabled()) {
    throw new LevelStartDomainError(
      "LEVEL_START_DISABLED",
      "curriculum level start is disabled",
    );
  }
  if (!isCurriculumV2ReadEnabled()) {
    throw new LevelStartDomainError(
      "CURRICULUM_READ_DISABLED",
      "curriculum read resolver is disabled",
    );
  }
  const evaluationTime = asOf ?? new Date();

  try {
    return await db.$transaction((tx) =>
      runStartTransaction(tx, actorUserId, evaluationTime, expectedStableCode),
    );
  } catch (error) {
    if (!isPrismaUniqueConflict(error)) throw error;
    // The loser of a concurrent identical start. The guard is re-applied so the
    // recovery path cannot return a level the caller never asked for.
    const recovered = await recoverConcurrentStart(
      db,
      actorUserId,
      evaluationTime,
      expectedStableCode,
    );
    if (recovered) return recovered;
    throw error;
  }
}
