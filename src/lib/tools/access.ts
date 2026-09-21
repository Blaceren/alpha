/**
 * TOOLS-V2 — may this learner USE a tool right now?
 *
 * THE SAME RULE AS `curriculum/tool-access.ts`, asked for one tool: the tool's
 * unlock level has a durable `UserLevelProgress` row in `completed` status, in
 * the learner's current enrollment. XP, `currentLevel`, a rank or a client-held
 * number never open anything.
 *
 * FAILS CLOSED. No enrollment, a superseded one, an unknown tool code, a level
 * the pinned version does not have, or a row in any status but `completed` —
 * every one of them answers "locked".
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
        where: { status: "completed", levelDefinition: { levelNumber: tool.unlockLevel } },
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
