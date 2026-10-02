/**
 * Tool unlock rows for a HAND-BUILT regression graph.
 *
 * Which level opens which tool is a row of the version itself since migration
 * `20261002120000_program_structure`: the importer writes the rows from the
 * package, and the migration wrote them for every version that already
 * existed. A regression that creates its levels with `levelDefinition.create`
 * goes through neither, so it states the rule here — the one a legacy-shaped
 * version carries: the level whose NUMBER is the tool's legacy unlock level,
 * where the graph has such a level.
 *
 * One helper, so the six tool regressions cannot each restate the mapping and
 * drift from the vocabulary it comes from.
 */
import type { PrismaClient } from "@prisma/client";
import { CURRICULUM_TOOLS } from "../../../src/lib/curriculum/product-vocabulary";

type UnlockDb = Pick<PrismaClient, "levelToolUnlock">;

export async function seedLegacyToolUnlocks(
  db: UnlockDb,
  curriculumVersionId: number,
  levels: readonly { id: number; levelNumber: number }[],
): Promise<void> {
  for (const tool of CURRICULUM_TOOLS) {
    const level = levels.find((candidate) => candidate.levelNumber === tool.unlockLevel);
    if (!level) continue;
    await db.levelToolUnlock.create({
      data: { levelDefinitionId: level.id, curriculumVersionId, toolCode: tool.code },
    });
  }
}
