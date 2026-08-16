/**
 * The Tools hub must derive unlocks from canonical curriculum progress, never
 * from a fixture scenario.
 *
 * These tests pin the two properties that actually matter: the marker is built
 * from completed levels only, and standing ON a level does not unlock the tool
 * that level awards. They do not re-implement the unlock rule — `projectTools`
 * still owns it and is called here rather than mirrored.
 */
import { describe, expect, it } from "vitest";
import { canonicalToolProgress } from "@/features/tools/model/canonical-progress";
import { projectTools } from "@/features/tools/model/tools-projection";
import type {
  AcademyCurriculumView,
  AcademyLevelSummary,
  AcademyModuleSummary,
} from "@/lib/curriculum/academy-view";

function lvl(order: number, state: AcademyLevelSummary["state"]): AcademyLevelSummary {
  return {
    levelCode: `v2.l${String(order).padStart(3, "0")}`,
    order,
    title: `Уровень ${order}`,
    shortDescription: null,
    learningObjective: "",
    typeInfo: { type: "lesson", label: "Урок", isCheckpoint: false, isExternal: false, supported: true },
    state,
    lockReason: state === "locked" ? "sequence" : null,
    stateLabel: state,
    completionSource: "learner",
    completionSourceLabel: "",
    requirements: { previousLevel: null, requiredXp: 0, checkpointLevel: null },
    routeAccessible: state !== "locked",
    actions: ["view"],
    href: `/lessons/v2.l${String(order).padStart(3, "0")}`,
    xpReward: 100,
    progressVersion: null,
    checkpoint: null,
    completionMethod: "assessment",
  } as AcademyLevelSummary;
}

function viewWith(completedThrough: number, total = 100): AcademyCurriculumView {
  const levels = Array.from({ length: total }, (_, i) =>
    lvl(i + 1, i + 1 <= completedThrough ? "completed" : i + 1 === completedThrough + 1 ? "available" : "locked"),
  );
  const modules: AcademyModuleSummary[] = [
    {
      moduleCode: "m01",
      order: 1,
      title: "Модуль",
      description: null,
      learningObjective: "",
      status: "published",
      levels,
      progress: { total: levels.length, completed: completedThrough },
    },
  ];
  return {
    state: "enrolled",
    curriculum: { curriculumCode: "ata-v2", curriculumVersion: 4, title: "T", status: "published", publishedAt: null },
    modules,
    progress: {
      currentLevelCode: levels[completedThrough]?.levelCode ?? null,
      currentModuleCode: "m01",
      nextAvailableLevelCode: null,
      completedLevels: completedThrough,
      totalLevels: total,
      xp: { available: false },
      updatedAt: null,
    },
  };
}

describe("canonicalToolProgress", () => {
  it("marks the first unfinished level, not the last completed one", () => {
    expect(canonicalToolProgress(viewWith(14))?.currentLevel).toBe(15);
  });

  it("returns null when there is no enrolled progression", () => {
    expect(
      canonicalToolProgress({ state: "candidate", curriculum: { curriculumCode: "c", curriculumVersion: 1, title: "T", status: "p", publishedAt: null }, modules: [], progress: null }),
    ).toBeNull();
    expect(canonicalToolProgress({ state: "unavailable", reason: "x" })).toBeNull();
  });

  it("only counts a CONTIGUOUS completed prefix — a gap does not award later tools", () => {
    const v = viewWith(9);
    // Punch a hole at level 5 and complete level 30 out of order.
    const levels = v.state === "enrolled" ? (v.modules[0]?.levels ?? []) : [];
    levels[4] = lvl(5, "available");
    levels[29] = lvl(30, "completed");
    expect(canonicalToolProgress(v)?.currentLevel).toBe(5);
  });

  it("reports allCompleted only when every level is done", () => {
    expect(canonicalToolProgress(viewWith(100))?.allCompleted).toBe(true);
    expect(canonicalToolProgress(viewWith(99))?.allCompleted).toBe(false);
  });
});

describe("canonical progress drives the real unlock resolver", () => {
  it("a learner who finished 14 levels has the L10 tool and NOT the L15 tool", () => {
    const tools = projectTools(canonicalToolProgress(viewWith(14))!);
    const at10 = tools.find((t) => t.unlockLevel === 10);
    const at15 = tools.find((t) => t.unlockLevel === 15);
    expect(at10?.unlocked).toBe(true);
    expect(at15?.unlocked).toBe(false);
    // And the locked one names the real milestone rather than a vague refusal.
    expect(at15?.statusLabel).toContain("15");
  });

  it("standing ON level 15 does not unlock the level-15 tool", () => {
    // 14 completed, currently on 15 — the gate is not passed.
    const tools = projectTools(canonicalToolProgress(viewWith(14))!);
    expect(tools.find((t) => t.unlockLevel === 15)?.unlocked).toBe(false);
  });

  it("completing level 15 does unlock it", () => {
    const tools = projectTools(canonicalToolProgress(viewWith(15))!);
    expect(tools.find((t) => t.unlockLevel === 15)?.unlocked).toBe(true);
  });

  it("no tool is unlocked for a learner at the very start", () => {
    const tools = projectTools(canonicalToolProgress(viewWith(0))!);
    expect(tools.every((t) => !t.unlocked)).toBe(true);
  });

  it("every tool is unlocked once the whole programme is complete", () => {
    const tools = projectTools(canonicalToolProgress(viewWith(100))!);
    expect(tools.every((t) => t.unlocked)).toBe(true);
  });
});
