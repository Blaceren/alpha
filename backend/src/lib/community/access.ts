/**
 * COMMUNITY-V1 — who may read and who may write, and on whose authority.
 *
 * ============================ THE AUTHORITY ============================
 * V2 CURRICULUM PROGRESSION, and nothing else. A space opens because the
 * learner durably completed the level it names, in the curriculum version their
 * enrollment is pinned to.
 *
 * WHAT IS NEVER READ HERE, each for a stated reason:
 *
 *   - `User.level` — V1 storage. It is live authority for V1 rank and for the
 *     legacy `/chat` gate, and it is NOT V2 curriculum authority. In PREPROD it
 *     reads `1` for EVERY learner, including two who have completed fourteen V2
 *     levels. A Community gate on it would refuse the learners it exists to
 *     serve. `LEGACY-USER-PROGRESS-COLUMNS-1` records the boundary; this file
 *     is the Community half of honouring it. Nothing here synchronises the two.
 *
 *   - `User.xp` / `XPTransaction` — XP is a reward. It opens nothing.
 *
 *   - `enrollment.highestCompletedLevel` — a summary counter, not the durable
 *     row. `tool-access.ts` refuses it for exactly this reason and Community
 *     follows the same rule rather than inventing a second, weaker one: a
 *     learner whose counter says 20 but whose level-14 row is not `completed`
 *     gets the access their rows justify, not the access their counter claims.
 *
 *   - `User.role` — a role is not progression. Staff read access is resolved
 *     separately and explicitly below.
 *
 *   - `UserTaskProgress` / `UserAchievement` — the V1 checkpoint and achievement
 *     tables the legacy channel gate reads. V2 Community does not.
 *
 * ============================== FAIL CLOSED ==============================
 * Every unknown resolves to NO ACCESS and says which unknown it was: no
 * enrollment, a corrupt enrollment, a pinned version with no level at the
 * required number, a level with no durable progress row, or a row in any status
 * other than `completed`. There is no branch that turns an absent fact into
 * access.
 *
 * ========================= THIS IS THE ONLY OWNER =========================
 * The Academy renders `canRead` / `canWrite` / `lockedReason` as given. It does
 * not re-derive them, and it is not given the inputs it would need to try.
 */
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";

export const DEFAULT_CURRICULUM_CODE = "ata-v2";

/**
 * Why a space is closed. A CLOSED vocabulary: the Academy switches on it, so a
 * free-text reason would be a string the client learns to parse.
 */
export type CommunityLockReason =
  /** Not enrolled in the curriculum at all. */
  | "not_enrolled"
  /** Enrolled, but has not completed the level this space requires. */
  | "level_incomplete"
  /** The learner may read here but not post yet. */
  | "write_level_incomplete"
  /** The enrollment could not be resolved to one consistent state. Fail closed. */
  | "progression_unavailable";

export type CommunitySpaceAccess = {
  readonly spaceId: number;
  readonly code: string;
  readonly title: string;
  readonly purpose: string;
  readonly orderIndex: number;
  readonly canRead: boolean;
  readonly canWrite: boolean;
  /** Null exactly when the learner may both read and write. */
  readonly lockedReason: CommunityLockReason | null;
  /** The level that opens reading. 0 means "any enrolled learner". */
  readonly readFromLevel: number;
  /** The level that opens posting. */
  readonly writeFromLevel: number;
  /**
   * The module number the blocking level belongs to, when one blocks. This is
   * what lets the Academy say «Откроется после завершения модуля 4» instead of
   * «Недостаточный уровень» — the requirement in the learner's own vocabulary.
   */
  readonly requiredModuleNumber: number | null;
};

export type CommunityAccess = {
  readonly enrolled: boolean;
  /**
   * Highest CONTIGUOUSLY completed level, derived from durable progress rows.
   * Present for context, never as the gate itself.
   */
  readonly completedLevels: number;
  /** The learner's current module number, for restrained progress context. */
  readonly currentModuleNumber: number | null;
  readonly spaces: readonly CommunitySpaceAccess[];
};

type Db = Pick<PrismaClient, "userCurriculumEnrollment" | "communitySpace">;

/**
 * The set of level NUMBERS this learner has durably completed, plus the module
 * map of the version they are pinned to.
 *
 * One query. `UserLevelProgress` is joined to `LevelDefinition` because a
 * progress row carries a definition id, and the space threshold is expressed as
 * a level NUMBER — the translation between the two is the pinned version's job
 * and must not be done by arithmetic.
 */
async function loadProgression(db: Db, userId: number) {
  const enrollment = await db.userCurriculumEnrollment.findFirst({
    where: { userId, curriculumCode: DEFAULT_CURRICULUM_CODE, status: "active" },
    orderBy: [{ enrolledAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      curriculumVersionId: true,
      levelProgress: {
        select: { status: true, levelDefinition: { select: { levelNumber: true } } },
      },
      curriculumVersion: {
        select: {
          modules: {
            select: { moduleNumber: true, firstLevel: true, lastLevel: true },
            orderBy: { moduleNumber: "asc" },
          },
        },
      },
    },
  });

  if (!enrollment) return null;

  const completed = new Set<number>();
  for (const progress of enrollment.levelProgress) {
    if (progress.status === "completed") completed.add(progress.levelDefinition.levelNumber);
  }

  return { completed, modules: enrollment.curriculumVersion.modules };
}

/**
 * The highest N such that every level 1..N is completed.
 *
 * Contiguous ON PURPOSE. A learner with levels 1-3 and 14 completed has
 * completed three levels, not fourteen: a gap means an earlier level was never
 * finished, and a space that opens on "module 4 done" must not open because one
 * later row exists. This is the same posture `level-state.ts` takes when it
 * treats a completed-sequence gap as corruption rather than as progress.
 */
function contiguousCompleted(completed: ReadonlySet<number>): number {
  let n = 0;
  while (completed.has(n + 1)) n += 1;
  return n;
}

function moduleOf(
  modules: ReadonlyArray<{ moduleNumber: number; firstLevel: number; lastLevel: number }>,
  levelNumber: number,
): number | null {
  const found = modules.find((m) => levelNumber >= m.firstLevel && levelNumber <= m.lastLevel);
  return found ? found.moduleNumber : null;
}

/**
 * Resolve every active space for one learner.
 *
 * `moderatorReadsAll` is granted ONLY to a caller the staff gate has already
 * authorized with `community_moderate`. It widens READING and never writing: a
 * moderator must be able to see what they are asked to moderate, and must not
 * acquire a posting right in a space their own progression has not opened.
 */
export async function resolveCommunityAccess(
  userId: number,
  options: { readonly db?: Db; readonly moderatorReadsAll?: boolean } = {},
): Promise<CommunityAccess> {
  const db = options.db ?? (defaultPrisma as unknown as Db);
  const moderatorReadsAll = options.moderatorReadsAll === true;

  const spaces = await db.communitySpace.findMany({
    where: { isActive: true },
    orderBy: { orderIndex: "asc" },
  });

  const progression = await loadProgression(db, userId);

  if (!progression) {
    // Not enrolled. Every space is closed, and it is closed for a reason the
    // learner can act on. A moderator with no enrollment still reads.
    return {
      enrolled: false,
      completedLevels: 0,
      currentModuleNumber: null,
      spaces: spaces.map((space) => ({
        spaceId: space.id,
        code: space.code,
        title: space.title,
        purpose: space.purpose,
        orderIndex: space.orderIndex,
        canRead: moderatorReadsAll,
        canWrite: false,
        lockedReason: "not_enrolled" as const,
        readFromLevel: space.readFromLevel,
        writeFromLevel: space.writeFromLevel,
        requiredModuleNumber: null,
      })),
    };
  }

  const completedLevels = contiguousCompleted(progression.completed);
  const currentModuleNumber = moduleOf(progression.modules, completedLevels + 1);

  return {
    enrolled: true,
    completedLevels,
    currentModuleNumber,
    spaces: spaces.map((space) => {
      const canRead = moderatorReadsAll || completedLevels >= space.readFromLevel;
      const canWrite = completedLevels >= space.writeFromLevel;

      let lockedReason: CommunityLockReason | null = null;
      if (!canRead) lockedReason = "level_incomplete";
      else if (!canWrite) lockedReason = "write_level_incomplete";

      // The module named to the learner is the one containing the level that
      // still blocks them — the read threshold if they cannot read, otherwise
      // the write threshold.
      const blockingLevel = !canRead ? space.readFromLevel : !canWrite ? space.writeFromLevel : null;

      return {
        spaceId: space.id,
        code: space.code,
        title: space.title,
        purpose: space.purpose,
        orderIndex: space.orderIndex,
        canRead,
        canWrite,
        lockedReason,
        readFromLevel: space.readFromLevel,
        writeFromLevel: space.writeFromLevel,
        requiredModuleNumber:
          blockingLevel === null ? null : moduleOf(progression.modules, blockingLevel),
      };
    }),
  };
}

/** One space by code, or null when it does not exist or is inactive. */
export function findSpaceAccess(
  access: CommunityAccess,
  code: string,
): CommunitySpaceAccess | null {
  return access.spaces.find((space) => space.code === code) ?? null;
}
