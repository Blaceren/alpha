/**
 * TOOLS-V2 — may this learner USE a tool right now?
 *
 * THE SAME RULE AS `curriculum/tool-access.ts`, asked for one tool: the level
 * that opens the tool IN THE LEARNER'S OWN VERSION has a durable
 * `UserLevelProgress` row in `completed` status, in the learner's current
 * enrollment. Which level that is comes from `LevelToolUnlock`, not from a
 * number in this repository. XP, `currentLevel`, a rank or a client-held number
 * never open anything.
 *
 * FAILS CLOSED. No enrollment, a superseded one, an unknown tool code, a
 * version that names no level for the tool, or a row in any status but
 * `completed` — every one of them answers "locked".
 */
import type { PrismaClient } from "@prisma/client";
import { DEFAULT_CURRICULUM_CODE } from "@/lib/curriculum/constants";
import { curriculumToolByCode } from "@/lib/curriculum/product-vocabulary";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { ToolError } from "./errors";

type Db = Pick<PrismaClient, "userCurriculumEnrollment">;

export async function isToolUnlockedForUser(
  userId: number,
  toolCode: string,
  db: Db = defaultPrisma,
): Promise<boolean> {
  const tool = curriculumToolByCode(toolCode);
  if (!tool) return false;

  const enrollment = await db.userCurriculumEnrollment.findFirst({
    where: { userId, curriculumCode: DEFAULT_CURRICULUM_CODE, status: { in: ["active", "completed"] } },
    orderBy: [{ enrolledAt: "desc" }, { id: "desc" }],
    select: {
      levelProgress: {
        // The unlock row is reached THROUGH the completed level, so the level
        // and the tool are tied to one version by the row itself: a completed
        // level of another version cannot satisfy this, whatever its number.
        where: {
          status: "completed",
          levelDefinition: { toolUnlocks: { some: { toolCode: tool.code } } },
        },
        select: { id: true },
        take: 1,
      },
    },
  });

  return (enrollment?.levelProgress.length ?? 0) > 0;
}

/** Throw `TOOL_LOCKED` unless the tool is open for this learner. */
export async function assertToolUnlocked(userId: number, toolCode: string, db?: Db): Promise<void> {
  if (!(await isToolUnlockedForUser(userId, toolCode, db))) throw new ToolError("TOOL_LOCKED");
}
