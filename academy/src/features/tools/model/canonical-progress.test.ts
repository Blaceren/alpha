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
import { toolAccessUnlockedThrough } from "@/features/tools/model/tool-access-fixture";

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
    toolAccess: null, // no Backend verdict in this fixture; null locks every tool
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

describe("canonical progress no longer drives the unlock resolver", () => {
  /* This block used to prove the opposite: that finishing level 14 opened the
     L10 tool and not the L15 one, all of it derived from the completed-level
     prefix. That rule is gone. The Backend decides access, and these cases now
     prove that the prefix cannot decide it — which is the only way to show the
     old authority is really out of the path (TOOLS-AUTHORITY-DIVERGENCE-1). */

  it("a fully completed learner gets nothing when there is no verdict", () => {
    // The strongest possible local progress, and a null verdict.
    const tools = projectTools(canonicalToolProgress(viewWith(100))!, null);
    expect(tools.every((t) => !t.unlocked)).toBe(true);
  });

  it("a learner at the very start gets everything the verdict opens", () => {
    const tools = projectTools(
      canonicalToolProgress(viewWith(0))!,
      toolAccessUnlockedThrough(101),
    );
    expect(tools.every((t) => t.unlocked)).toBe(true);
  });

  it("the same progress yields different answers under different verdicts", () => {
    const progress = canonicalToolProgress(viewWith(14))!;
    const closed = projectTools(progress, toolAccessUnlockedThrough(0));
    const open = projectTools(progress, toolAccessUnlockedThrough(16));
    expect(closed.find((t) => t.unlockLevel === 10)?.unlocked).toBe(false);
    expect(open.find((t) => t.unlockLevel === 10)?.unlocked).toBe(true);
  });

  it("a locked tool still names its milestone rather than refusing vaguely", () => {
    const tools = projectTools(canonicalToolProgress(viewWith(14))!, toolAccessUnlockedThrough(11));
    expect(tools.find((t) => t.unlockLevel === 15)?.statusLabel).toContain("15");
  });
});
