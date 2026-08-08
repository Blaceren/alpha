import type {
  CurriculumVersion,
  LevelDefinition,
  ModuleDefinition,
  UserCurriculumEnrollment,
} from "@prisma/client";
import type { CheckpointReadModel } from "./checkpoint";
import { resolveCheckpointVerification, isFinancialCheckpointType } from "./checkpoint";
import type { UserCurriculumLevelStatesResult } from "./level-state";
import {
  resolveCompletedCurriculumToolAccess,
  resolveCurriculumToolAccess,
  summarizeToolAccess,
} from "./tool-access";
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
    /*
     * PHASE-F — the full 19-tool access set (§18/§20).
     *
     * Emitted on the FULL read only. It is resolved from the same `levels`
     * snapshot this response is already serialising, so it cannot observe a
     * different moment than the level states beside it, and it costs no extra
     * query. The Home summary carries the slim projection instead — see
     * `mapEnrolledCurriculumSummary`.
     */
    toolAccess: resolveCurriculumToolAccess(levelStates.levels),
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
    // PHASE-F. Same rule as the enrolled read, resolved from the durable
    // progress rows a completed enrollment carries instead of level states.
    toolAccess: resolveCompletedCurriculumToolAccess(context.levels, context.progress),
  };
}

/* ------------------------------------------------------------------------ */
/* A6 — the slim Home shape                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Home needs six facts: where the learner is, how far along, which module,
 * what the current level is and whether it can be acted on, what comes next,
 * and how much XP there is. The default `/current` response answers those by
 * serialising the ENTIRE curriculum graph — for the 100-level curriculum that
 * is 100 level objects with their definitions, blockers, progress and
 * checkpoint blocks, every time the Home screen loads, to render one card.
 *
 * This is the same resolution, projected down. It runs the identical resolver
 * on the identical snapshot — no second source of truth, no separate progress
 * calculation — and then emits only the fields above.
 *
 * WHAT IS DELIBERATELY ABSENT: every field of every other level, and anything
 * that identifies the learner. There is no email, no name, no id, no IP, no
 * referral code and no balance — a checkpoint's block here is the same bounded
 * read model the full response uses, which has no field a financial value could
 * occupy.
 *
 * FACTS, NOT A CTA. `presentationState`, `blockers`, `type` and
 * `completionMethod` travel so Home can decide what its button says. Deciding
 * that here would put product copy in a serializer and give Home a second place
 * to disagree with the level map about what is possible.
 */
function summaryLevel(item: ResolvedLevelStates["levels"][number]) {
  return {
    levelNumber: item.levelDefinition.levelNumber,
    stableCode: item.levelDefinition.stableCode,
    type: item.levelDefinition.type,
    title: item.levelDefinition.title,
    shortDescription: item.levelDefinition.shortDescription,
    completionMethod: item.levelDefinition.completionMethod,
    xpReward: item.levelDefinition.xpReward,
    requiredXp: item.levelDefinition.requiredXp,
    durableStatus: item.progress?.status ?? null,
    presentationState: item.state,
    blockers: [...item.blockers],
    checkpoint: mapCheckpoint(item.checkpoint),
  };
}

/** Whole percent, floored, clamped. 0 levels means 0 rather than NaN. */
function percentComplete(completed: number, total: number) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((completed * 100) / total)));
}

export function mapEnrolledCurriculumSummary(levelStates: ResolvedLevelStates) {
  const current = levelStates.levels.find(
    (item) => item.levelDefinition.levelNumber === levelStates.enrollment.currentLevel,
  );
  if (!current) throw new Error("current level definition missing");
  const next =
    levelStates.levels.find(
      (item) =>
        item.levelDefinition.levelNumber === levelStates.enrollment.currentLevel + 1,
    ) ?? null;
  const moduleDefinition =
    levelStates.modules.find(
      (candidate) => candidate.id === current.levelDefinition.moduleId,
    ) ?? null;
  const totalLevels = levelStates.levels.length;
  const completedLevels = levelStates.levels.filter(
    (item) => item.state === "completed",
  ).length;

  const xp: CurriculumReadXp =
    levelStates.xp.kind === "disabled"
      ? { kind: "disabled" }
      : mapXp(levelStates.xp, current.levelDefinition.requiredXp);

  return {
    kind: "enrolled" as const,
    shape: "summary" as const,
    curriculum: mapCurriculum(levelStates.curriculumVersion),
    enrollment: mapEnrollment(levelStates.enrollment),
    progress: {
      currentLevel: levelStates.enrollment.currentLevel,
      highestCompletedLevel: levelStates.enrollment.highestCompletedLevel,
      completedLevels,
      totalLevels,
      percentComplete: percentComplete(completedLevels, totalLevels),
    },
    // `null` when the current level's module is somehow not in the resolved
    // set. The resolver already refuses that shape as corrupt, so this is a
    // belt-and-braces null rather than a state Home should expect.
    currentModule: moduleDefinition ? mapModule(moduleDefinition) : null,
    currentLevel: summaryLevel(current),
    nextLevel: next
      ? {
          levelNumber: next.levelDefinition.levelNumber,
          stableCode: next.levelDefinition.stableCode,
          type: next.levelDefinition.type,
          title: next.levelDefinition.title,
          presentationState: next.state,
        }
      : null,
    xp,
    /*
     * PHASE-F — the SLIM tool projection (§20).
     *
     * Counts plus the open codes: bounded at nineteen short strings, which is
     * what Home needs to say «3 из 19 инструментов открыто» and to decide
     * whether a tool card belongs on the screen at all. The full per-tool
     * context (unlock level, gate title, reason) stays on the full read.
     *
     * Derived from the SAME resolution the full read emits, so the two can never
     * disagree about which tools are open.
     */
    toolAccess: summarizeToolAccess(resolveCurriculumToolAccess(levelStates.levels)),
  };
}

export function mapCompletedCurriculumSummary(
  context: CompletedContext,
  xp?: Extract<CurriculumReadXp, { kind: "disabled" }> | AvailableXp,
) {
  const totalLevels = context.levels.length;
  const completedLevels = context.progress.filter(
    (progress) => progress.status === "completed",
  ).length;
  const mappedXp = !xp ? undefined : xp.kind === "disabled" ? xp : mapXp(xp, null);
  return {
    kind: "completed" as const,
    shape: "summary" as const,
    curriculum: mapCurriculum(context.curriculumVersion),
    enrollment: mapEnrollment(context.enrollment),
    progress: {
      currentLevel: context.enrollment.currentLevel,
      highestCompletedLevel: context.enrollment.highestCompletedLevel,
      completedLevels,
      totalLevels,
      percentComplete: percentComplete(completedLevels, totalLevels),
    },
    // A finished enrollment has no module to be working in and nothing next.
    currentModule: null,
    currentLevel: null,
    nextLevel: null,
    ...(mappedXp ? { xp: mappedXp } : {}),
    // PHASE-F. A finished enrollment still has tools, and Home still has to say
    // how many. Same durable rule; no level-state resolution to project from.
    toolAccess: summarizeToolAccess(
      resolveCompletedCurriculumToolAccess(context.levels, context.progress),
    ),
  };
}

export function mapCandidateCurriculumSummary(
  context: Extract<UserCurriculumContextResult, { kind: "candidate" }>,
  xp?: Extract<CurriculumReadXp, { kind: "disabled" }>,
) {
  return {
    kind: "candidate" as const,
    shape: "summary" as const,
    curriculum: {
      ...mapCurriculum(context.curriculumVersion),
      moduleCount: context.modules.length,
      levelCount: context.levels.length,
    },
    enrollment: null,
    progress: {
      currentLevel: null,
      highestCompletedLevel: 0,
      completedLevels: 0,
      totalLevels: context.levels.length,
      percentComplete: 0,
    },
    currentModule: null,
    currentLevel: null,
    nextLevel: null,
    ...(xp ? { xp } : {}),
  };
}

export function mapUnavailableCurriculumSummary(
  context: Extract<UserCurriculumContextResult, { kind: "unavailable" }>,
  xp?: Extract<CurriculumReadXp, { kind: "disabled" }>,
) {
  return {
    kind: "unavailable" as const,
    shape: "summary" as const,
    reason: context.reason,
    ...(xp ? { xp } : {}),
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
