import type {
  CurriculumVersion,
  LevelDefinition,
  ModuleDefinition,
  UserCurriculumEnrollment,
} from "@prisma/client";
import type { CheckpointReadModel } from "./checkpoint";
import { resolveCheckpointVerification, isFinancialCheckpointType } from "./checkpoint";
import type { UserCurriculumLevelStatesResult } from "./level-state";
import type { ResolveEnrollmentXpResult } from "./xp";
import type {
  ResolvedProgress,
  UserCurriculumContextResult,
} from "./resolver";

type CompletedContext = Extract<UserCurriculumContextResult, { kind: "completed" }>;
type ResolvedLevelStates = Extract<
  UserCurriculumLevelStatesResult,
  { kind: "resolved" }
>;
type AvailableXp = Extract<ResolveEnrollmentXpResult, { kind: "available" }>;

export type CurriculumReadXp =
  | { kind: "disabled" }
  | {
      kind: "available";
      currentXp: number;
      transactionCount: number;
      lastTransactionAt: string | null;
      nextLevelRequiredXp: number | null;
      xpRemaining: number;
    };

function toIso(value: Date | null) {
  return value?.toISOString() ?? null;
}

function mapCurriculum(version: CurriculumVersion) {
  return {
    code: version.code,
    name: version.name,
    versionNumber: version.versionNumber,
    status: version.status,
    effectiveFrom: toIso(version.effectiveFrom),
    publishedAt: toIso(version.publishedAt),
  };
}

function mapEnrollment(enrollment: UserCurriculumEnrollment) {
  return {
    status: enrollment.status,
    enrolledAt: enrollment.enrolledAt.toISOString(),
    currentLevel: enrollment.currentLevel,
    highestCompletedLevel: enrollment.highestCompletedLevel,
    lastMeaningfulActionAt: toIso(enrollment.lastMeaningfulActionAt),
    completedAt: toIso(enrollment.completedAt),
  };
}

function mapModule(moduleDefinition: ModuleDefinition) {
  return {
    moduleNumber: moduleDefinition.moduleNumber,
    code: moduleDefinition.code,
    title: moduleDefinition.title,
    description: moduleDefinition.description,
    firstLevel: moduleDefinition.firstLevel,
    lastLevel: moduleDefinition.lastLevel,
    checkpointLevel: moduleDefinition.checkpointLevel,
    learningObjective: moduleDefinition.learningObjective,
    status: moduleDefinition.status,
  };
}

/**
 * The bounded checkpoint block. Emitted only for `financial_checkpoint` levels
 * and only from definition + feature-flag state.
 *
 * It carries no observed balance, no remaining amount, no account data and no
 * open metadata object — the read model has no field a financial value could
 * occupy, so the privacy rule holds structurally rather than by review.
 */
function mapCheckpoint(checkpoint: CheckpointReadModel | null) {
  if (!checkpoint) return null;
  return {
    kind: checkpoint.kind,
    integrationCode: checkpoint.integrationCode,
    verificationState: checkpoint.verificationState,
    verificationReason: checkpoint.verificationReason,
    canVerify: checkpoint.canVerify,
    canStart: checkpoint.canStart,
    canComplete: checkpoint.canComplete,
    retryAfterSeconds: checkpoint.retryAfterSeconds,
  };
}

function mapLevelDefinition(levelDefinition: LevelDefinition) {
  return {
    levelNumber: levelDefinition.levelNumber,
    stableCode: levelDefinition.stableCode,
    type: levelDefinition.type,
    title: levelDefinition.title,
    shortDescription: levelDefinition.shortDescription,
    learningObjective: levelDefinition.learningObjective,
    completionMethod: levelDefinition.completionMethod,
    xpReward: levelDefinition.xpReward,
    requirements: {
      previousLevel: levelDefinition.requiredPreviousLevel,
      requiredXp: levelDefinition.requiredXp,
      checkpointLevel: levelDefinition.requiredCheckpointLevel,
    },
    status: levelDefinition.status,
  };
}

function mapProgress(progress: ResolvedProgress | null) {
  if (!progress) return null;
  return {
    status: progress.status,
    startedAt: progress.startedAt.toISOString(),
    lastProgressAt: toIso(progress.lastProgressAt),
    completedAt: toIso(progress.completedAt),
    completionMethod: progress.completionMethod,
    attemptCount: progress.attemptCount,
  };
}

function mapEnrolledModules(context: ResolvedLevelStates) {
  return context.modules.map((moduleDefinition) => ({
    ...mapModule(moduleDefinition),
    levels: context.levels
      .filter((item) => item.levelDefinition.moduleId === moduleDefinition.id)
      .map((item) => ({
        ...mapLevelDefinition(item.levelDefinition),
        durableStatus: item.progress?.status ?? null,
        presentationState: item.state,
        blockers: [...item.blockers],
        progress: mapProgress(item.progress),
        checkpoint: mapCheckpoint(item.checkpoint),
      })),
  }));
}

function mapCompletedModules(context: CompletedContext) {
  const progressByLevelId = new Map(
    context.progress.map((progress) => [progress.levelDefinitionId, progress]),
  );
  return context.modules.map((moduleDefinition) => ({
    ...mapModule(moduleDefinition),
    levels: context.levels
      .filter((levelDefinition) => levelDefinition.moduleId === moduleDefinition.id)
      .map((levelDefinition) => {
        const progress = progressByLevelId.get(levelDefinition.id) ?? null;
        return {
          ...mapLevelDefinition(levelDefinition),
          durableStatus: progress?.status ?? null,
          progress: mapProgress(progress),
          // A completed enrollment has no level-state resolution, so the
          // checkpoint block is derived directly from the definition and the
          // durable progress row. A checkpoint the learner already passed reads
          // as `completed`; anything else reads as unavailable, because a
          // finished enrollment offers no new verification.
          checkpoint: isFinancialCheckpointType(levelDefinition.type)
            ? mapCheckpoint(
                resolveCheckpointVerification({
                  integrationCode: levelDefinition.featureUnlockCode,
                  completed: progress?.status === "completed",
                }),
              )
            : null,
        };
      }),
  }));
}

export function mapCandidateCurriculumRead(
  context: Extract<UserCurriculumContextResult, { kind: "candidate" }>,
  xp?: Extract<CurriculumReadXp, { kind: "disabled" }>,
) {
  return {
    kind: "candidate" as const,
    curriculum: {
      ...mapCurriculum(context.curriculumVersion),
      moduleCount: context.modules.length,
      levelCount: context.levels.length,
    },
    enrollment: null,
    ...(xp ? { xp } : {}),
  };
}

function mapXp(
  summary: { totalXp: number; transactionCount: number; lastTransactionAt: Date | null },
  nextLevelRequiredXp: number | null,
): CurriculumReadXp {
  if (
    !Number.isSafeInteger(summary.totalXp) ||
    summary.totalXp < 0 ||
    !Number.isSafeInteger(summary.transactionCount) ||
    summary.transactionCount < 0 ||
    (nextLevelRequiredXp !== null &&
      (!Number.isSafeInteger(nextLevelRequiredXp) || nextLevelRequiredXp < 0))
  ) {
    throw new Error("invalid curriculum XP summary");
  }
  return {
    kind: "available",
    currentXp: summary.totalXp,
    transactionCount: summary.transactionCount,
    lastTransactionAt: toIso(summary.lastTransactionAt),
    nextLevelRequiredXp,
    xpRemaining:
      nextLevelRequiredXp === null
        ? 0
        : Math.max(0, nextLevelRequiredXp - summary.totalXp),
  };
}

export function mapEnrolledCurriculumRead(
  levelStates: ResolvedLevelStates,
) {
  const currentDefinition = levelStates.levels.find(
    (item) =>
      item.levelDefinition.levelNumber === levelStates.enrollment.currentLevel,
  );
  if (!currentDefinition) throw new Error("current level definition missing");
  const xp: CurriculumReadXp =
    levelStates.xp.kind === "disabled"
      ? { kind: "disabled" }
      : mapXp(levelStates.xp, currentDefinition.levelDefinition.requiredXp);
  return {
    kind: "enrolled" as const,
    curriculum: mapCurriculum(levelStates.curriculumVersion),
    enrollment: mapEnrollment(levelStates.enrollment),
    modules: mapEnrolledModules(levelStates),
    xp,
  };
}

export function mapCompletedCurriculumRead(
  context: CompletedContext,
  xp?: Extract<CurriculumReadXp, { kind: "disabled" }> | AvailableXp,
) {
  const mappedXp = !xp
    ? undefined
    : xp.kind === "disabled"
      ? xp
      : mapXp(xp, null);
  return {
    kind: "completed" as const,
    curriculum: mapCurriculum(context.curriculumVersion),
    enrollment: mapEnrollment(context.enrollment),
    modules: mapCompletedModules(context),
    ...(mappedXp ? { xp: mappedXp } : {}),
  };
}

export function mapUnavailableCurriculumRead(
  context: Extract<UserCurriculumContextResult, { kind: "unavailable" }>,
  xp?: Extract<CurriculumReadXp, { kind: "disabled" }>,
) {
  return {
    kind: "unavailable" as const,
    reason: context.reason,
    ...(xp ? { xp } : {}),
  };
}
