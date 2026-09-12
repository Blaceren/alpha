/**
 * PHASE-1 ADMIN — the canonical V2 progression snapshot, for CRM.
 *
 * WHY IT EXISTS. The production CRM learner detail has been rendering a section
 * headed «Прогресс» whose two rows are `User.level` and `User.xp` — the LEGACY
 * V1 columns. In PREPROD they read 1 and 0 for every learner, including the two
 * who have completed fourteen V2 levels, so an operator looking at a learner has
 * been reading a number that is not their Academy progress and has no
 * relationship to it. That was survivable while the screen was read-only. It
 * stops being survivable the moment an operator can ACT on what they see, so
 * this ships in the same release as the action.
 *
 * IT COMPUTES NOTHING OF ITS OWN. Every field is read from the owner that
 * already decides it: the enrollment counters for position, durable
 * `UserLevelProgress` rows for what is completed, `resolveEnrollmentXp` for the
 * V2 ledger total and `resolveCompletedCurriculumToolAccess` for tools. A second
 * implementation of "which level is this learner on" is exactly the drift this
 * phase exists to avoid, and the audit that preceded it found three read models
 * already disagreeing on injected state.
 *
 * IT IS NOT A LEVEL-STATE RESOLUTION. `resolveUserCurriculumLevelStates` is the
 * learner-facing authority and it fails CLOSED on a corrupt enrollment, which is
 * right for a learner and wrong for an operator: the one person who most needs
 * to see a broken enrollment is the person whose job is to fix it. So this reads
 * the durable rows directly and reports what it finds, including a `consistent`
 * flag that says whether the canonical invariant currently holds.
 */
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CURRICULUM_CODE } from "./constants";
import {
  resolveCompletedCurriculumToolAccess,
  summarizeToolAccess,
} from "./tool-access";
import { resolveEnrollmentXp } from "./xp";

export type LearnerProgressionLevel = {
  levelNumber: number;
  stableCode: string;
  title: string;
  type: string;
  completionMethod: string;
  xpReward: number;
};

export type LearnerProgressionSnapshot =
  | { kind: "not_enrolled"; learnerUserId: number }
  | {
      kind: "enrolled";
      learnerUserId: number;
      enrollmentId: number;
      enrollmentStatus: string;
      curriculumCode: string;
      curriculumVersionId: number;
      curriculumVersionNumber: number;
      curriculumStatus: string;
      totalLevels: number;
      highestCompletedLevel: number;
      currentLevel: number;
      /** Null when the enrollment has terminally completed the curriculum. */
      currentLevelDefinition: LearnerProgressionLevel | null;
      completedLevelCount: number;
      /** V2 ledger total. Never `User.xp`. */
      xpTotal: number | null;
      toolsUnlockedCount: number;
      toolsTotal: number;
      /**
       * Does the canonical invariant hold right now?
       *
       * `currentLevel === highestCompletedLevel + 1`, and the completed rows form
       * the contiguous prefix the counters claim. Surfaced rather than enforced:
       * an operator seeing `false` is looking at the exact situation a
       * correction exists for, and hiding it behind a fail-closed error would
       * leave them with a blank panel and no vocabulary for what is wrong.
       */
      consistent: boolean;
      /** Every level in the pinned version, so a target can be chosen. */
      levels: readonly (LearnerProgressionLevel & {
        status: "none" | "in_progress" | "pending_review" | "completed";
      })[];
    };

export async function resolveLearnerProgressionSnapshot(
  learnerUserId: number,
  db: Pick<PrismaClient, "userCurriculumEnrollment"> = prisma,
): Promise<LearnerProgressionSnapshot> {
  const enrollment = await db.userCurriculumEnrollment.findFirst({
    where: { userId: learnerUserId, status: "active" },
    orderBy: { id: "desc" },
    include: {
      curriculumVersion: {
        select: {
          id: true,
          code: true,
          status: true,
          versionNumber: true,
          levels: true,
        },
      },
      levelProgress: {
        select: { levelDefinitionId: true, status: true },
      },
    },
  });
  if (!enrollment || enrollment.curriculumVersion.code !== DEFAULT_CURRICULUM_CODE) {
    return { kind: "not_enrolled", learnerUserId };
  }

  const definitions = [...enrollment.curriculumVersion.levels].sort(
    (left, right) => left.levelNumber - right.levelNumber,
  );
  const statusByLevelId = new Map(
    enrollment.levelProgress.map((row) => [row.levelDefinitionId, row.status]),
  );
  const completedNumbers = new Set(
    definitions
      .filter((level) => statusByLevelId.get(level.id) === "completed")
      .map((level) => level.levelNumber),
  );

  // The same invariant `deriveEnrolledLevelStates` enforces, evaluated rather
  // than enforced. Contiguity is checked over the counter's own claim, so a
  // learner with a hole in their prefix reports `false` instead of throwing.
  let consistent = enrollment.currentLevel === enrollment.highestCompletedLevel + 1;
  if (consistent) {
    for (let levelNumber = 1; levelNumber <= enrollment.highestCompletedLevel; levelNumber += 1) {
      if (!completedNumbers.has(levelNumber)) {
        consistent = false;
        break;
      }
    }
    if (completedNumbers.size !== enrollment.highestCompletedLevel) consistent = false;
  }

  const xp = await resolveEnrollmentXp({ enrollmentId: enrollment.id });
  const toolAccess = summarizeToolAccess(
    resolveCompletedCurriculumToolAccess(definitions, enrollment.levelProgress),
  );

  const describe = (level: (typeof definitions)[number]): LearnerProgressionLevel => ({
    levelNumber: level.levelNumber,
    stableCode: level.stableCode,
    title: level.title,
    type: level.type,
    completionMethod: level.completionMethod,
    xpReward: level.xpReward,
  });

  const current =
    definitions.find((level) => level.levelNumber === enrollment.currentLevel) ?? null;

  return {
    kind: "enrolled",
    learnerUserId,
    enrollmentId: enrollment.id,
    enrollmentStatus: enrollment.status,
    curriculumCode: enrollment.curriculumVersion.code,
    curriculumVersionId: enrollment.curriculumVersionId,
    curriculumVersionNumber: enrollment.curriculumVersion.versionNumber,
    curriculumStatus: enrollment.curriculumVersion.status,
    totalLevels: definitions.length,
    highestCompletedLevel: enrollment.highestCompletedLevel,
    currentLevel: enrollment.currentLevel,
    currentLevelDefinition: current ? describe(current) : null,
    completedLevelCount: completedNumbers.size,
    xpTotal: xp.kind === "available" ? xp.totalXp : null,
    toolsUnlockedCount: toolAccess.unlockedCount,
    toolsTotal: toolAccess.total,
    consistent,
    levels: definitions.map((level) => ({
      ...describe(level),
      status: statusByLevelId.get(level.id) ?? "none",
    })),
  };
}
