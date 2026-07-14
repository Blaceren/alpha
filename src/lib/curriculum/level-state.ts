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
  type CurriculumResolverDb,
  type ResolvedProgress,
  type SafeResolverDiagnostics,
  type UserCurriculumContextResult,
} from "./resolver";

export type EffectiveLevelState =
  | "completed"
  | "pending_review"
  | "in_progress"
  | "available"
  | "locked";

export type LevelStateBlockerCode =
  | "not_current_level"
  | "sequence_incomplete"
  | "definition_inactive"
  | "xp_engine_unavailable"
  | "checkpoint_engine_unavailable"
  | "visibility_rule_unsupported";

export type EffectiveLevelStateItem = {
  levelDefinition: LevelDefinition;
  moduleDefinition: ModuleDefinition;
  progress: ResolvedProgress | null;
  state: EffectiveLevelState;
  blockers: LevelStateBlockerCode[];
};

export type LevelStateCorruptReason =
  | "invalid_level_sequence"
  | "invalid_summary_progress"
  | "invalid_progress_timestamps"
  | "multiple_available_levels";

type ResolvedLevelStateContext = {
  kind: "resolved";
  userId: number;
  enrollment: UserCurriculumEnrollment;
  curriculumVersion: CurriculumVersion;
  modules: ModuleDefinition[];
  levels: EffectiveLevelStateItem[];
};

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
  db?: CurriculumResolverDb;
};

function corruptLevelState(
  reason: string,
  diagnostics: SafeResolverDiagnostics,
): Extract<UserCurriculumLevelStatesResult, { kind: "corrupt" }> {
  return { kind: "corrupt", reason, diagnostics };
}

function deriveEnrolledLevelStates(
  context: Extract<UserCurriculumContextResult, { kind: "enrolled" }>,
): UserCurriculumLevelStatesResult {
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
    if (levelDefinition.requiredXp > 0) {
      blockers.push("xp_engine_unavailable");
    }
    if (levelDefinition.requiredCheckpointLevel !== null) {
      blockers.push("checkpoint_engine_unavailable");
    }
    if (levelDefinition.visibilityRule !== null) {
      blockers.push("visibility_rule_unsupported");
    }

    return {
      levelDefinition,
      moduleDefinition,
      progress,
      state: blockers.length === 0 ? "available" : "locked",
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
  };
}

export async function resolveUserCurriculumLevelStates({
  userId,
  asOf = new Date(),
  db = prisma,
}: ResolveUserCurriculumLevelStatesInput): Promise<UserCurriculumLevelStatesResult> {
  if (!isCurriculumV2ReadEnabled()) return { kind: "disabled" };

  const context = await resolveUserCurriculumContext({ userId, asOf, db });
  if (context.kind === "disabled") return context;
  if (context.kind === "user_not_found") return context;
  if (context.kind === "corrupt") return context;
  if (context.kind === "completed") {
    return { kind: "unavailable", reason: "enrollment_completed" };
  }
  if (context.kind === "enrolled") return deriveEnrolledLevelStates(context);
  if (context.kind === "unavailable") {
    return { kind: "unavailable", reason: "curriculum_unavailable" };
  }
  return { kind: "unavailable", reason: "no_active_enrollment" };
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
  asOf: Date,
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
    asOf,
    db: tx,
  });
  if (result.kind !== "resolved") mapLevelStateFailure(result);
  return { result, state: currentState(result) };
}

async function runStartTransaction(
  tx: Prisma.TransactionClient,
  actorUserId: number,
  asOf: Date,
): Promise<StartCurrentCurriculumLevelResult> {
  const { result, state } = await loadStartState(tx, actorUserId, asOf);

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
      startedAt: asOf,
      lastProgressAt: asOf,
      attemptCount: 0,
    },
  });
  const enrollment = await tx.userCurriculumEnrollment.update({
    where: { id: result.enrollment.id },
    data: { lastMeaningfulActionAt: asOf },
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
  asOf: Date,
): Promise<StartCurrentCurriculumLevelResult | null> {
  return db.$transaction(async (tx) => {
    const { result, state } = await loadStartState(tx, actorUserId, asOf);
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
  asOf = new Date(),
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

  try {
    return await db.$transaction((tx) =>
      runStartTransaction(tx, actorUserId, asOf),
    );
  } catch (error) {
    if (!isPrismaUniqueConflict(error)) throw error;
    const recovered = await recoverConcurrentStart(db, actorUserId, asOf);
    if (recovered) return recovered;
    throw error;
  }
}
