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
import { prisma } from "@/lib/prisma";
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
  | "locked";

export type LevelStateBlockerCode =
  | "not_current_level"
  | "sequence_incomplete"
  | "definition_inactive"
  | "xp_engine_unavailable"
  | "xp_insufficient"
  | "checkpoint_engine_unavailable"
  | "visibility_rule_unsupported";

export type EffectiveLevelStateItem = {
  levelDefinition: LevelDefinition;
  moduleDefinition: ModuleDefinition;
  progress: ResolvedProgress | null;
  state: EffectiveLevelState;
  blockers: LevelStateBlockerCode[];
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

function deriveEnrolledLevelStates(
  context: Extract<UserCurriculumContextResult, { kind: "enrolled" }>,
  xp: LevelStateXpSummary,
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

  const levels: EffectiveLevelStateItem[] = definitions.map((levelDefinition) => {
    const moduleDefinition = moduleById.get(levelDefinition.moduleId)!;
    const progress = progressByLevelId.get(levelDefinition.id) ?? null;
    if (progress) {
      return {
        levelDefinition,
        moduleDefinition,
        progress,
        state: progress.status,
        blockers: [],
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
    for (let previous = 1; previous < levelDefinition.levelNumber; previous += 1) {
      if (!completedNumbers.has(previous)) {
        blockers.push("sequence_incomplete");
        break;
      }
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

    let state: EffectiveLevelState;
    if (blockers.length === 0) {
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

  return deriveEnrolledLevelStates(context, xpSummary);
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
  | "LEVEL_START_NOT_AVAILABLE";

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

async function runStartTransaction(
  tx: Prisma.TransactionClient,
  actorUserId: number,
  evaluationTime: Date,
): Promise<StartCurrentCurriculumLevelResult> {
  const { result, state } = await loadStartState(
    tx,
    actorUserId,
    evaluationTime,
  );

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
  const enrollment = await tx.userCurriculumEnrollment.update({
    where: { id: result.enrollment.id },
    data: { lastMeaningfulActionAt: evaluationTime },
  });

  await tx.auditLog.create({
    data: {
      userId: actorUserId,
      action: CURRICULUM_AUDIT_ACTIONS.levelStarted,
      entityType: "UserLevelProgress",
      entityId: String(progress.id),
      metadata: {
        actorUserId,
        userId: actorUserId,
        enrollmentId: enrollment.id,
        curriculumVersionId: result.curriculumVersion.id,
        levelDefinitionId: state.levelDefinition.id,
        levelNumber: state.levelDefinition.levelNumber,
        stableCode: state.levelDefinition.stableCode,
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
): Promise<StartCurrentCurriculumLevelResult | null> {
  return db.$transaction(async (tx) => {
    const { result, state } = await loadStartState(
      tx,
      actorUserId,
      evaluationTime,
    );
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

export async function startCurrentCurriculumLevel({
  actorUserId,
  asOf,
  db = prisma,
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
      runStartTransaction(tx, actorUserId, evaluationTime),
    );
  } catch (error) {
    if (!isPrismaUniqueConflict(error)) throw error;
    const recovered = await recoverConcurrentStart(
      db,
      actorUserId,
      evaluationTime,
    );
    if (recovered) return recovered;
    throw error;
  }
}
