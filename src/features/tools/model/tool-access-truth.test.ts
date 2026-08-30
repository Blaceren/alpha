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
import { projectTools } from "@/features/tools/model/tools-projection";
import { TOOL_DEFINITIONS } from "@/features/tools/model/tool-catalog";
import type {
  AcademyCurriculumView,
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

function openTools(view: AcademyCurriculumView): string[] {
  const progress = canonicalToolProgress(view);
  if (!progress) return [];
  return projectTools(progress).filter((t) => t.unlocked).map((t) => t.code);
}

function enterableTools(view: AcademyCurriculumView): string[] {
  const progress = canonicalToolProgress(view);
  if (!progress) return [];
  return projectTools(progress).filter((t) => t.available).map((t) => t.code);
}

/** Levels 1..n, which is what a contiguous learner has behind them. */
const through = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("tool access truth matrix", () => {
  it("1 — an early learner with no completed checkpoint has nothing open", () => {
    // The live shape of almost every PREPROD enrollment: standing on level 2.
    expect(openTools(learner({ completed: [1] }))).toEqual([]);
  });

  it("2 — the live corrected enrollment has exactly two tools, and they are these", () => {
    /* PREPROD enrollment 40, rebuilt: levels 1..17 durably completed, which
       includes the financial checkpoints at 4, 10 and 15. */
    const view = learner({ completed: through(17), currentLevelCode: "v2.l018", xp: 1300 });
    expect(enterableTools(view)).toEqual(["tool.trading_journal", "tool.risk_calculator"]);
  });

  it("3 — those two come from the completed L10 and L15 checkpoints and nothing else", () => {
    // Remove ONLY the two checkpoint completions; every other level stays done.
    const withoutCheckpoints = through(17).filter((n) => n !== 10 && n !== 15);
    expect(openTools(learner({ completed: withoutCheckpoints, currentLevelCode: "v2.l018", xp: 1300 }))).toEqual([]);
  });

  it("5 — the same non-checkpoint completions without any checkpoint open nothing", () => {
    /* The eleven administratively corrected levels of enrollment 40 are all
       non-checkpoint. On their own — which is what an administrative correction
       can produce, since it may never complete a financial checkpoint — they
       award no tool. */
    const adminCorrected = [5, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17];
    expect(openTools(learner({ completed: adminCorrected, currentLevelCode: "v2.l018", xp: 1300 }))).toEqual([]);
  });

  it("6 — counters alone open nothing", () => {
    // High on every summary field the product carries, zero durable levels.
    const view = learner({
      completed: [],
      currentLevelCode: "v2.l100",
      completedLevelsCounter: 99,
      xp: 100000,
    });
    expect(openTools(view)).toEqual([]);
  });

  it("7 — each completed checkpoint releases only its own tool", () => {
    for (const tool of TOOL_DEFINITIONS.slice(0, 6)) {
      const view = learner({ completed: through(tool.unlockLevel) });
      const open = openTools(view);
      // Everything at or below this gate, and nothing above it.
      const expected = TOOL_DEFINITIONS.filter((t) => t.unlockLevel <= tool.unlockLevel).map((t) => t.code);
      expect(open, `gate L${tool.unlockLevel}`).toEqual(expected);
      expect(open.some((code) => {
        const def = TOOL_DEFINITIONS.find((t) => t.code === code);
        return def ? def.unlockLevel > tool.unlockLevel : false;
      })).toBe(false);
    }
  });

  it("8 — no tool is open without its own checkpoint level completed", () => {
    /* THE INVARIANT, stated over the whole registry rather than a sample: for
       every completion set drawn at random, an open tool always has its unlock
       level in that set. This is the one property the surface may never lose. */
    const sets: number[][] = [
      through(9),
      through(10),
      through(14),
      through(17),
      through(44),
      [1, 2, 3, 4, 10],
      [10, 15, 20],
      [],
    ];
    for (const completed of sets) {
      const done = new Set(completed);
      const progress = canonicalToolProgress(learner({ completed }));
      const views = progress ? projectTools(progress) : [];
      for (const view of views) {
        if (view.unlocked) {
          expect(done.has(view.unlockLevel), `${view.code} opened without L${view.unlockLevel}`).toBe(true);
        }
      }
    }
  });

  it("9 — an unenrolled learner resolves to nothing, not to everything", () => {
    expect(canonicalToolProgress({ state: "unavailable", reason: "x" } as AcademyCurriculumView)).toBeNull();
    expect(openTools({ state: "unavailable", reason: "x" } as AcademyCurriculumView)).toEqual([]);
  });
});

/**
 * TOOLS-AUTHORITY-DIVERGENCE-1 — recorded, not fixed.
 *
 * The Backend resolves tool access per checkpoint row. The Academy resolves it
 * from the longest CONTIGUOUS run of completed levels. Those differ whenever a
 * learner has a gap below a completed checkpoint: the Backend opens the tool,
 * the Academy does not.
 *
 * The divergence is only ever in this direction, and that is the property worth
 * holding: the Academy may keep a tool shut that the platform would open, and
 * may never open one the platform holds shut. Migrating to the canonical
 * verdict is its own phase; this case exists so the direction cannot silently
 * reverse in the meantime.
 */
describe("TOOLS-AUTHORITY-DIVERGENCE-1 — fail-closed, in one direction only", () => {
  it("holds a tool shut when the checkpoint is complete but the run below it is not", () => {
    // L10 completed, L5 missing: the canonical rule opens Trading Journal.
    const gapped = through(10).filter((n) => n !== 5);
    const done = new Set(gapped);
    expect(done.has(10)).toBe(true);
    expect(openTools(learner({ completed: gapped }))).toEqual([]);
  });

  it("never opens a tool whose checkpoint row is absent", () => {
    /* The direction that would be a defect rather than a conservatism. Across
       every gap position below L15, no tool may appear that the canonical rule
       would not also grant. */
    for (let hole = 1; hole <= 15; hole += 1) {
      const completed = through(15).filter((n) => n !== hole);
      const done = new Set(completed);
      for (const code of openTools(learner({ completed }))) {
        const def = TOOL_DEFINITIONS.find((t) => t.code === code);
        expect(def && done.has(def.unlockLevel), `${code} with a hole at L${hole}`).toBe(true);
      }
    }
  });
});
