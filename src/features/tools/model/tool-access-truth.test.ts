/**
 * TOOL ACCESS TRUTH — what may and may not open a tool.
 *
 * The unlock levels of all nineteen tools are financial checkpoints. The
 * platform's canonical authority is a durable `UserLevelProgress` row on that
 * checkpoint level; the Academy reaches the same answer through the completed
 * state of the level in the curriculum view. Neither of those is a counter, and
 * this file exists so that nothing quietly becomes one.
 *
 * The rows below were taken from the deployed PREPROD database read-only, then
 * rebuilt as isolated fixtures. Nothing here reads or writes live data.
 *
 * NOT A SECOND UNLOCK RULE. Every case calls `projectTools` — the same function
 * the pages call — and asserts on what it returns. Mirroring the rule here
 * would prove only that the mirror agrees with itself.
 */
import { describe, expect, it } from "vitest";
import { canonicalToolProgress } from "@/features/tools/model/canonical-progress";
import { projectTool, projectTools } from "@/features/tools/model/tools-projection";
import { readBackendToolAccess } from "@/lib/curriculum/backend-dto";
import { toolAccessUnlockedThrough } from "@/features/tools/model/tool-access-fixture";
import {
  RISK_CALCULATOR_CODE,
  TOOL_DEFINITIONS,
  TRADING_JOURNAL_CODE,
} from "@/features/tools/model/tool-catalog";
import type {
  AcademyCurriculumView,
  AcademyToolAccess,
  AcademyLevelSummary,
  AcademyModuleSummary,
} from "@/lib/curriculum/academy-view";

/** The checkpoint levels that release a tool, from the catalogue itself. */
const UNLOCK_LEVELS = TOOL_DEFINITIONS.map((t) => t.unlockLevel);

function level(order: number, completed: boolean): AcademyLevelSummary {
  const code = `v2.l${String(order).padStart(3, "0")}`;
  const isCheckpoint = UNLOCK_LEVELS.includes(order) || order === 4;
  return {
    levelCode: code,
    order,
    title: `Уровень ${order}`,
    shortDescription: null,
    learningObjective: "",
    typeInfo: {
      type: isCheckpoint ? "financial-checkpoint" : "lesson",
      label: isCheckpoint ? "Контрольная точка" : "Урок",
      isCheckpoint,
      isExternal: false,
      supported: true,
    },
    state: completed ? "completed" : "locked",
    lockReason: completed ? null : "sequence",
    stateLabel: completed ? "Завершён" : "Заблокирован",
    completionSource: "learner",
    completionSourceLabel: "",
    requirements: { previousLevel: null, requiredXp: 0, checkpointLevel: null },
    routeAccessible: completed,
    actions: ["view"],
    href: `/lessons/${code}`,
    xpReward: 100,
    progressVersion: null,
    checkpoint: null,
    completionMethod: isCheckpoint ? "checkpoint" : "assessment",
  } as AcademyLevelSummary;
}

/**
 * A learner described ONLY by which levels are durably completed.
 *
 * The counters are passed separately and deliberately: `currentLevel`,
 * `highestCompletedLevel` and XP are the three things that must never move the
 * answer, so the fixture can set them to anything at all.
 */
function learner(opts: {
  completed: number[];
  currentLevelCode?: string;
  completedLevelsCounter?: number;
  xp?: number;
  total?: number;
}): AcademyCurriculumView {
  const total = opts.total ?? 100;
  const done = new Set(opts.completed);
  const levels = Array.from({ length: total }, (_, i) => level(i + 1, done.has(i + 1)));
  const modules: AcademyModuleSummary[] = [
    {
      moduleCode: "m01",
      order: 1,
      title: "Модуль",
      description: null,
      learningObjective: "",
      status: "published",
      levels,
      progress: { total, completed: done.size },
    },
  ];
  return {
    state: "enrolled",
    curriculum: { curriculumCode: "ata-v2", curriculumVersion: 4, title: "T", status: "published", publishedAt: null },
    modules,
    progress: {
      currentLevelCode: opts.currentLevelCode ?? null,
      currentModuleCode: "m01",
      nextAvailableLevelCode: null,
      completedLevels: opts.completedLevelsCounter ?? done.size,
      totalLevels: total,
      xp: opts.xp === undefined ? { available: false } : { available: true, total: opts.xp },
      updatedAt: null,
    },
  } as AcademyCurriculumView;
}

/* The hub's answer, resolved exactly as the hub resolves it. */
function openTools(view: AcademyCurriculumView, access: AcademyToolAccess | null): string[] {
  const progress = canonicalToolProgress(view);
  if (!progress) return [];
  return projectTools(progress, access).filter((t) => t.unlocked).map((t) => t.code);
}

function enterableTools(view: AcademyCurriculumView, access: AcademyToolAccess | null): string[] {
  const progress = canonicalToolProgress(view);
  if (!progress) return [];
  return projectTools(progress, access).filter((t) => t.available).map((t) => t.code);
}

/** The direct URL's answer for one code, resolved as that route resolves it. */
function directAnswer(view: AcademyCurriculumView, access: AcademyToolAccess | null, code: string) {
  const progress = canonicalToolProgress(view);
  return progress ? projectTool(code, progress, access) : null;
}

/** A verdict built by hand, so a case can say something a rule would not. */
function verdict(entries: Array<{ code: string; unlocked: boolean; unlockLevel?: number }>): AcademyToolAccess {
  const tools = entries.map((e) => ({
    code: e.code,
    unlocked: e.unlocked,
    unlockLevel: e.unlockLevel ?? TOOL_DEFINITIONS.find((t) => t.id === e.code)?.unlockLevel ?? 0,
  }));
  return { total: tools.length, unlockedCount: tools.filter((t) => t.unlocked).length, tools };
}

/** Levels 1..n, which is what a contiguous learner has behind them. */
const through = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("tool access truth matrix — the Backend decides, and only the Backend", () => {
  /* This file used to prove that the completed-checkpoint set opened a tool.
     It no longer does, because that rule is no longer in the path. What it
     proves now is the harder thing: that local progression cannot open or close
     anything, in either direction (TOOLS-AUTHORITY-DIVERGENCE-1). */

  it("1 — the Backend says locked, and a finished learner still sees it locked", () => {
    const done = learner({ completed: through(100) });
    const closed = verdict(TOOL_DEFINITIONS.map((t) => ({ code: t.id, unlocked: false })));
    expect(openTools(done, closed)).toEqual([]);
  });

  it("2 — the Backend says unlocked, and a learner with a gap still sees it unlocked", () => {
    // Nothing completed below L10; the old rule would have refused this.
    const gapped = learner({ completed: [10] });
    const open = verdict([{ code: TRADING_JOURNAL_CODE, unlocked: true }]);
    expect(openTools(gapped, open)).toContain(TRADING_JOURNAL_CODE);
  });

  it("3 — a missing verdict locks everything", () => {
    const done = learner({ completed: through(100) });
    expect(openTools(done, null)).toEqual([]);
    expect(enterableTools(done, null)).toEqual([]);
  });

  it("4 — a malformed tools list is refused, and refusal means locked", () => {
    const done = learner({ completed: through(100) });
    for (const malformed of [
      { total: 1, unlockedCount: 1, tools: [{ code: TRADING_JOURNAL_CODE, unlocked: "true", unlockLevel: 10 }] },
      { total: 1, unlockedCount: 0, tools: [{ code: "", unlocked: true, unlockLevel: 10 }] },
      { total: 1, unlockedCount: 0, tools: "not-an-array" },
      { total: 2, unlockedCount: 0, tools: [{ code: TRADING_JOURNAL_CODE, unlocked: false, unlockLevel: 10 }] },
      { total: 1, unlockedCount: 5, tools: [{ code: TRADING_JOURNAL_CODE, unlocked: false, unlockLevel: 10 }] },
    ]) {
      expect(readBackendToolAccess(malformed), JSON.stringify(malformed)).toBeNull();
      expect(openTools(done, readBackendToolAccess(malformed))).toEqual([]);
    }
  });

  it("5 — a code the catalogue does not know opens nothing, and invents no row", () => {
    const done = learner({ completed: through(100) });
    const stray = verdict([{ code: "tool.not_in_the_catalogue", unlocked: true, unlockLevel: 1 }]);
    expect(openTools(done, stray)).toEqual([]);
    expect(directAnswer(done, stray, "tool.not_in_the_catalogue")).toBeNull();
  });

  it("6 — a duplicate code is fail-closed rather than last-wins", () => {
    const payload = {
      total: 2,
      unlockedCount: 1,
      tools: [
        { code: TRADING_JOURNAL_CODE, unlocked: true, unlockLevel: 10 },
        { code: TRADING_JOURNAL_CODE, unlocked: false, unlockLevel: 10 },
      ],
    };
    // Two answers for one tool is not one answer.
    expect(readBackendToolAccess(payload)).toBeNull();
    expect(openTools(learner({ completed: through(100) }), readBackendToolAccess(payload))).toEqual([]);
  });

  it("7 — a level completed by an administrative correction does not move the verdict", () => {
    /* The Academy cannot see how a level was completed, and that is the point:
       it does not look. Whatever the level list says, the verdict is what the
       Backend sent, and the Backend refuses admin_correction on a financial
       checkpoint at its own boundary. */
    const corrected = learner({ completed: through(100), completedLevelsCounter: 100, xp: 99999 });
    const closed = verdict(TOOL_DEFINITIONS.map((t) => ({ code: t.id, unlocked: false })));
    expect(openTools(corrected, closed)).toEqual([]);
    expect(directAnswer(corrected, closed, TRADING_JOURNAL_CODE)?.unlocked).toBe(false);
  });

  it("8 — the hub and the direct URL give the same answer for every tool", () => {
    const view = learner({ completed: [10, 15] });
    const access = verdict([
      { code: TRADING_JOURNAL_CODE, unlocked: true },
      { code: RISK_CALCULATOR_CODE, unlocked: false },
    ]);
    const hub = openTools(view, access);
    for (const tool of TOOL_DEFINITIONS) {
      const direct = directAnswer(view, access, tool.id);
      expect(direct?.unlocked === true, tool.id).toBe(hub.includes(tool.id));
    }
  });

  it("9 — an unenrolled learner resolves to nothing, not to everything", () => {
    const notEnrolled = { state: "candidate" } as AcademyCurriculumView;
    expect(openTools(notEnrolled, toolAccessUnlockedThrough(101))).toEqual([]);
  });

  it("10 — only the two built tools can ever be entered", () => {
    const everything = verdict(TOOL_DEFINITIONS.map((t) => ({ code: t.id, unlocked: true })));
    const enterable = enterableTools(learner({ completed: through(100) }), everything);
    expect(enterable.sort()).toEqual([RISK_CALCULATOR_CODE, TRADING_JOURNAL_CODE].sort());
  });

  it("11 — no local access decision survives: the projection never consults the level prefix", () => {
    /* Same verdict, wildly different progressions. If any prefix rule were left
       in the path, these two would disagree. */
    const closedVerdict = verdict([{ code: TRADING_JOURNAL_CODE, unlocked: false }]);
    const openVerdict = verdict([{ code: TRADING_JOURNAL_CODE, unlocked: true }]);
    for (const completed of [[], [1, 2, 3], through(50), through(100)]) {
      const view = learner({ completed });
      expect(openTools(view, closedVerdict)).toEqual([]);
      expect(openTools(view, openVerdict)).toEqual([TRADING_JOURNAL_CODE]);
    }
  });
});
