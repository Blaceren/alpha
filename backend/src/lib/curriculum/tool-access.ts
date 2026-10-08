/**
 * PHASE-F — SERVER-AUTHORITATIVE TOOL ACCESS. Closes Phase-E M-2.
 *
 * ============================== THE GAP THIS CLOSES ==============================
 * Phase E made the Academy stop deciding tool unlock from a client-held level
 * number, which was the right correction — but it could only go halfway, because
 * Backend did not transmit per-tool access at all. So the Academy asked the
 * curriculum view for the state of the level whose number the tool registry
 * happened to hold, and read the verdict off that. Server-derived, but still an
 * ACADEMY-COMPOSED rule: two Backend facts joined by a client-side join.
 *
 * This module performs that join on the server, once, and emits the answer.
 * After it, "which tools may this learner open?" has exactly one implementation
 * on the platform and it lives here.
 *
 * ================================ THE RULE ================================
 * A tool is unlocked when the LEVEL THAT RELEASES IT is durably completed for
 * this enrollment.
 *
 * WHICH LEVEL THAT IS BELONGS TO THE VERSION (2026-10-02). It used to be one
 * global number per tool, `CURRICULUM_TOOLS[].unlockLevel`, which is true only
 * while every published version has the same shape. The 30-level program opens
 * the Trading Journal after level 9 and both the Risk Plan and the Entry
 * Checklist after level 13; a learner still pinned to the 100-level version
 * keeps levels 10, 15 and 20. So the answer is now read from `LevelToolUnlock`,
 * the pinned version's own rows — written by the importer from the package, and
 * by migration `20261002120000_program_structure` for every version that
 * existed before it. `CURRICULUM_TOOLS` still says WHICH tools exist and in
 * what order they are listed; its `unlockLevel` is the rule old packages were
 * written under, and is read here only to keep a display number on a tool the
 * pinned version never opens.
 *
 * WHAT DECIDES: `UserLevelProgress.status === "completed"` on that level.
 * WHAT DOES NOT DECIDE, and is never read here:
 *   - `enrollment.currentLevel` — arithmetic on it is exactly the rule Phase E
 *     removed from the client; reproducing it on the server would be the same
 *     mistake with better hosting. A learner who is anomalously on level 90 with
 *     level 10 incomplete has NO tools, and that is the correct answer.
 *   - `highestCompletedLevel` — a summary counter, not the durable row.
 *   - XP, of any amount. XP is a reward; it opens nothing (§28).
 *   - a rank. Ranks are curriculum transitions, not access.
 *
 * ============================== FAIL CLOSED ==============================
 * Every unknown resolves to LOCKED and says which unknown it was:
 *   - the pinned version has no level at the tool's unlock number → locked;
 *   - the level exists but has no durable progress row               → locked;
 *   - the row is `in_progress`, `pending_review`, or anything else   → locked.
 * There is no branch below that turns an absent fact into access.
 *
 * ========================= WHAT THIS MODULE NEVER DOES =========================
 * It reads. It opens no transaction, writes no row, and takes no request. It is
 * a projection over state some other owner already established, which is what
 * lets the read API call it from inside the existing snapshot without widening
 * anything.
 */
import type { LevelDefinition, UserLevelProgress } from "@prisma/client";
import { CURRICULUM_TOOLS, type CurriculumTool } from "./product-vocabulary";

/**
 * Why a tool is open or closed. A CLOSED vocabulary: the Academy switches on it
 * and must be able to enumerate it, and a free-text reason would be a string the
 * client learns to parse.
 */
export type CurriculumToolAccessReason =
  /** The unlock checkpoint is durably completed. */
  | "unlock_level_completed"
  /** The unlock checkpoint exists and is not completed. */
  | "unlock_level_incomplete"
  /** The pinned curriculum version has no level at that number. Fail closed. */
  | "unlock_level_missing"
  /** There is no enrollment to resolve against. Fail closed. */
  | "not_enrolled";

export type CurriculumToolAccessEntry = {
  /** Canonical tool code. */
  readonly code: string;
  /** THE verdict. The only field an access decision may be taken from. */
  readonly unlocked: boolean;
  /** DISPLAY: the level number that releases this tool. */
  readonly unlockLevel: number;
  /** DISPLAY: that level's stable code, or null when the version has no such level. */
  readonly unlockLevelStableCode: string | null;
  /** DISPLAY: that level's title, so a surface can name the gate. */
  readonly unlockLevelTitle: string | null;
  /** Why, from the closed vocabulary above. */
  readonly reason: CurriculumToolAccessReason;
};

/**
 * The learner-facing tool access set: every curriculum tool, always, in
 * canonical unlock order.
 *
 * The whole set travels even when nothing is open, because "absent" and "locked"
 * must not be the same wire state — a client that has to infer a missing entry's
 * meaning is a client that will eventually infer it as open.
 */
export type CurriculumToolAccess = {
  readonly total: number;
  readonly unlockedCount: number;
  readonly tools: readonly CurriculumToolAccessEntry[];
};

/**
 * The slim Home-shaped projection (§20).
 *
 * Home renders at most a small tool context and must not pay for the full set,
 * so the summary carries the counts and the open codes — bounded by the size of
 * the tool catalog — and nothing else. It is a PROJECTION of the same resolution, never a
 * second one: `summarizeToolAccess` takes the full result as its input, so the
 * two shapes cannot disagree about what is open.
 */
export type CurriculumToolAccessSummary = {
  readonly total: number;
  readonly unlockedCount: number;
  readonly unlocked: readonly string[];
};

/** The durable facts one level contributes. Nothing else about it is read. */
type ToolAccessLevel = {
  id: number;
  levelNumber: number;
  stableCode: string;
  title: string;
  completed: boolean;
};

/**
 * One `LevelToolUnlock` row of the pinned version: this level opens this tool.
 *
 * Passed IN rather than read here, so the module stays a projection — it opens
 * no query of its own, and whoever resolved the levels decides which snapshot
 * the rows come from.
 */
export type CurriculumToolUnlockRow = {
  readonly toolCode: string;
  readonly levelDefinitionId: number;
};

type ToolUnlockDb = {
  levelToolUnlock: {
    findMany(args: {
      where: { curriculumVersionId: number };
      select: { toolCode: true; levelDefinitionId: true };
    }): Promise<CurriculumToolUnlockRow[]>;
  };
};

/** The pinned version's unlock rows. One bounded query: at most one row per tool. */
export async function loadCurriculumToolUnlocks(
  db: ToolUnlockDb,
  curriculumVersionId: number,
): Promise<CurriculumToolUnlockRow[]> {
  return db.levelToolUnlock.findMany({
    where: { curriculumVersionId },
    select: { toolCode: true, levelDefinitionId: true },
  });
}

function lockedEntry(
  tool: CurriculumTool,
  reason: Extract<CurriculumToolAccessReason, "unlock_level_missing" | "not_enrolled">,
): CurriculumToolAccessEntry {
  return {
    code: tool.code,
    unlocked: false,
    unlockLevel: tool.unlockLevel,
    unlockLevelStableCode: null,
    unlockLevelTitle: null,
    reason,
  };
}

function resolveFromLevels(
  levels: readonly ToolAccessLevel[],
  unlocks: readonly CurriculumToolUnlockRow[],
): CurriculumToolAccess {
  const byId = new Map<number, ToolAccessLevel>();
  for (const level of levels) byId.set(level.id, level);
  // First row wins. The table is unique on (version, tool), so a second row for
  // one tool cannot exist; if a caller ever hands one over, it is ignored rather
  // than allowed to open a tool the first row keeps shut.
  const unlockLevelIdByTool = new Map<string, number>();
  for (const unlock of unlocks) {
    if (!unlockLevelIdByTool.has(unlock.toolCode)) {
      unlockLevelIdByTool.set(unlock.toolCode, unlock.levelDefinitionId);
    }
  }

  const tools = CURRICULUM_TOOLS.map((tool): CurriculumToolAccessEntry => {
    const levelId = unlockLevelIdByTool.get(tool.code);
    // No row, or a row naming a level outside the resolved version: the pinned
    // version does not open this tool. Locked, and it says so.
    const level = levelId === undefined ? undefined : byId.get(levelId);
    if (!level) return lockedEntry(tool, "unlock_level_missing");
    return {
      code: tool.code,
      unlocked: level.completed,
      unlockLevel: level.levelNumber,
      unlockLevelStableCode: level.stableCode,
      unlockLevelTitle: level.title,
      reason: level.completed ? "unlock_level_completed" : "unlock_level_incomplete",
    };
  });

  return {
    total: tools.length,
    unlockedCount: tools.filter((entry) => entry.unlocked).length,
    tools,
  };
}

/**
 * Tool access for an ENROLLED learner, from the resolved level states.
 *
 * The input is the same `levels` array the read API already has in hand, so this
 * costs no extra query and cannot observe a different snapshot than the rest of
 * the response.
 */
export function resolveCurriculumToolAccess(
  levels: readonly {
    levelDefinition: Pick<LevelDefinition, "id" | "levelNumber" | "stableCode" | "title">;
    progress: Pick<UserLevelProgress, "status"> | null;
  }[],
  unlocks: readonly CurriculumToolUnlockRow[],
): CurriculumToolAccess {
  return resolveFromLevels(
    levels.map((item) => ({
      id: item.levelDefinition.id,
      levelNumber: item.levelDefinition.levelNumber,
      stableCode: item.levelDefinition.stableCode,
      title: item.levelDefinition.title,
      // The DURABLE row, not the presentation state. A level presenting as
      // `completed` because of some future display rule would not open a tool.
      completed: item.progress?.status === "completed",
    })),
    unlocks,
  );
}

/**
 * Tool access for a COMPLETED enrollment, which has no level-state resolution.
 *
 * Same rule, same fail-closed behaviour: a completed enrollment whose unlocking
 * row is somehow not `completed` does not get the tool, however finished the
 * enrollment claims to be.
 */
export function resolveCompletedCurriculumToolAccess(
  levels: readonly Pick<LevelDefinition, "id" | "levelNumber" | "stableCode" | "title">[],
  progress: readonly Pick<UserLevelProgress, "levelDefinitionId" | "status">[],
  unlocks: readonly CurriculumToolUnlockRow[],
): CurriculumToolAccess {
  const completedLevelIds = new Set(
    progress.filter((row) => row.status === "completed").map((row) => row.levelDefinitionId),
  );
  return resolveFromLevels(
    levels.map((level) => ({
      id: level.id,
      levelNumber: level.levelNumber,
      stableCode: level.stableCode,
      title: level.title,
      completed: completedLevelIds.has(level.id),
    })),
    unlocks,
  );
}

/** Everything locked, for a learner with no enrollment to resolve against. */
export function lockedCurriculumToolAccess(): CurriculumToolAccess {
  const tools = CURRICULUM_TOOLS.map((tool) => lockedEntry(tool, "not_enrolled"));
  return { total: tools.length, unlockedCount: 0, tools };
}

/** The Home-shaped projection of an already-resolved access set. */
export function summarizeToolAccess(
  access: CurriculumToolAccess,
): CurriculumToolAccessSummary {
  return {
    total: access.total,
    unlockedCount: access.unlockedCount,
    unlocked: access.tools.filter((entry) => entry.unlocked).map((entry) => entry.code),
  };
}
