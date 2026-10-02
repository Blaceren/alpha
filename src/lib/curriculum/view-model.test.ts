import { describe, it, expect } from "vitest";
import { toAcademyCurriculumView, findLevel, buildLevelDetail, mapLevelContent } from "@/lib/curriculum/view-model";
import type { BackendCurriculumRead, BackendLevel } from "@/lib/curriculum/backend-dto";

function level(partial: Partial<BackendLevel> & { levelNumber: number; stableCode: string; type: string }): BackendLevel {
  return {
    title: `L${partial.levelNumber}`,
    shortDescription: null,
    learningObjective: "obj",
    completionMethod: "manual",
    xpReward: 10,
    requirements: { previousLevel: partial.levelNumber === 1 ? null : partial.levelNumber - 1, requiredXp: 0, checkpointLevel: null },
    status: "active",
    durableStatus: null,
    progress: null,
    ...partial,
  } as BackendLevel;
}

function enrolledRead(): BackendCurriculumRead {
  return {
    kind: "enrolled",
    curriculum: { code: "ata-v2", name: "ATA", versionNumber: 2, status: "published", effectiveFrom: null, publishedAt: "2026-01-01T00:00:00.000Z" },
    enrollment: { status: "active", enrolledAt: "2026-01-01T00:00:00.000Z", currentLevel: 2, highestCompletedLevel: 1, lastMeaningfulActionAt: "2026-02-01T00:00:00.000Z", completedAt: null },
    modules: [
      {
        moduleNumber: 1, code: "m01", title: "Module 1", description: "d", firstLevel: 1, lastLevel: 4, checkpointLevel: 4, learningObjective: "lo", status: "active",
        // Deliberately out of order to prove ordering is by number, not array index.
        levels: [
          level({ levelNumber: 2, stableCode: "l002", type: "lesson", presentationState: "available", blockers: [] }),
          level({ levelNumber: 1, stableCode: "l001", type: "external_event", presentationState: "completed", blockers: [], durableStatus: "completed", progress: { status: "completed", startedAt: "2026-01-02T00:00:00.000Z", lastProgressAt: "2026-01-02T00:00:00.000Z", completedAt: "2026-01-02T00:00:00.000Z", completionMethod: "manual", attemptCount: 1 } }),
          level({ levelNumber: 4, stableCode: "l004", type: "financial_checkpoint", presentationState: "locked", blockers: ["not_current_level", "sequence_incomplete", "checkpoint_engine_unavailable"], requirements: { previousLevel: 3, requiredXp: 0, checkpointLevel: 4 } }),
          level({ levelNumber: 3, stableCode: "l003", type: "report", presentationState: "locked", blockers: ["not_current_level", "sequence_incomplete"] }),
        ],
      },
    ],
    xp: { kind: "disabled" },
  };
}

describe("toAcademyCurriculumView (enrolled)", () => {
  const view = toAcademyCurriculumView(enrolledRead());
  if (view.state !== "enrolled") throw new Error("expected enrolled");

  it("orders levels by levelNumber, keyed by stable code (not array index)", () => {
    const codes = view.modules[0]!.levels.map((l) => l.levelCode);
    expect(codes).toEqual(["l001", "l002", "l003", "l004"]);
  });

  it("renders server-authoritative states", () => {
    const byCode = Object.fromEntries(view.modules[0]!.levels.map((l) => [l.levelCode, l.state]));
    expect(byCode).toEqual({ l001: "completed", l002: "available", l003: "locked", l004: "locked" });
  });

  it("checkpoint level (L4) is a checkpoint locked with checkpoint reason", () => {
    const l4 = view.modules[0]!.levels.find((l) => l.levelCode === "l004")!;
    expect(l4.typeInfo.isCheckpoint).toBe(true);
    expect(l4.lockReason).toBe("checkpoint");
    expect(l4.routeAccessible).toBe(false);
  });

  it("derives progress summary from Backend, not local heuristics", () => {
    expect(view.progress.currentLevelCode).toBe("l002");
    expect(view.progress.nextAvailableLevelCode).toBe("l002");
    expect(view.progress.completedLevels).toBe(1);
    expect(view.progress.totalLevels).toBe(4);
    expect(view.progress.xp).toEqual({ available: false });
  });

  it("does not expose email/xp-internal/prisma fields (only whitelisted keys)", () => {
    const level0 = view.modules[0]!.levels[0]!;
    // G3 adds `completionMethod`: a bounded, mapped display value (never the raw
    // Backend string) that tells the page whether a `lesson` is finished by a
    // graded check or by an explicit learner declaration. It carries no learner
    // data, so the property this whitelist protects is unchanged.
    expect(Object.keys(level0).sort()).toEqual(
      // PROGRAM STRUCTURE adds `kind`, `kindLabel` and `inProduction`: three
      // facts about the published level itself, none about the learner.
      ["actions", "checkpoint", "completionMethod", "completionSource", "completionSourceLabel", "href", "inProduction", "kind", "kindLabel", "learningObjective", "levelCode", "lockReason", "order", "progressVersion", "requirements", "routeAccessible", "shortDescription", "state", "stateLabel", "title", "typeInfo", "xpReward"].sort(),
    );
  });

  it("maps completionMethod through a closed vocabulary, fail-closed", () => {
    const level0 = view.modules[0]!.levels[0]!;
    expect(
      ["external-event", "assessment", "report", "formal-report", "checkpoint", "manual", "lesson", "mentor-review", "unsupported"],
    ).toContain(level0.completionMethod);
  });

  it("a program without chapters or kinds says nothing about them — nothing is synthesised", () => {
    expect(view.modules[0]!.chapter).toBeNull();
    const l2 = view.modules[0]!.levels.find((l) => l.levelCode === "l002")!;
    expect(l2.kind).toBeNull();
    expect(l2.kindLabel).toBe(l2.typeInfo.label);
    expect(l2.inProduction).toBe(false);
    expect(view.progress.openLevels).toBe(view.progress.totalLevels);
  });
});

/**
 * PROGRAM STRUCTURE (2026-10-02) — the 30-level program's shape, as the read
 * model carries it: chapters over modules, the author's kind on a level, and a
 * tail of levels the program has defined and not opened yet.
 */
function funnelRead(): BackendCurriculumRead {
  const open = (n: number, extra: Partial<BackendLevel> = {}) =>
    level({
      levelNumber: n,
      stableCode: `l${String(n).padStart(3, "0")}`,
      type: "lesson",
      presentationState: "completed",
      blockers: [],
      durableStatus: "completed",
      ...extra,
    });
  return {
    kind: "enrolled",
    curriculum: { code: "ata-v2", name: "ATA", versionNumber: 5, status: "published", effectiveFrom: null, publishedAt: "2026-10-02T00:00:00.000Z" },
    enrollment: { status: "active", enrolledAt: "2026-10-02T00:00:00.000Z", currentLevel: 4, highestCompletedLevel: 3, lastMeaningfulActionAt: null, completedAt: null },
    modules: [
      {
        moduleNumber: 1, code: "m01", title: "Module 1", description: null, firstLevel: 1, lastLevel: 3, checkpointLevel: null, learningObjective: "lo", status: "active",
        chapter: { number: 1, title: "Основы" },
        levels: [
          open(1, { completionMethod: "lesson", kind: "lesson" }),
          open(2, { completionMethod: "formal_check", type: "report", kind: "report" }),
          open(3, { completionMethod: "pocket_postback", type: "external_event", kind: "task" }),
        ],
      },
      {
        moduleNumber: 2, code: "m02", title: "Module 2", description: null, firstLevel: 4, lastLevel: 5, checkpointLevel: null, learningObjective: "lo", status: "disabled",
        chapter: { number: 2, title: "Чтение графика" },
        levels: [
          level({ levelNumber: 4, stableCode: "l004", type: "lesson", completionMethod: "lesson", kind: "assembly", status: "disabled", presentationState: "locked", blockers: ["definition_inactive"] }),
          level({ levelNumber: 5, stableCode: "l005", type: "external_event", completionMethod: "pocket_postback", kind: "future-kind", status: "disabled", presentationState: "locked", blockers: ["not_current_level", "sequence_incomplete", "definition_inactive"] }),
        ],
      },
    ],
    xp: { kind: "disabled" },
  };
}

describe("toAcademyCurriculumView (program structure)", () => {
  const view = toAcademyCurriculumView(funnelRead());
  if (view.state !== "enrolled") throw new Error("expected enrolled");
  const byCode = Object.fromEntries(view.modules.flatMap((m) => m.levels).map((l) => [l.levelCode, l]));

  it("carries each module's chapter exactly as published", () => {
    expect(view.modules.map((m) => m.chapter)).toEqual([
      { number: 1, title: "Основы" },
      { number: 2, title: "Чтение графика" },
    ]);
  });

  it("names a level by the author's kind, and falls back to the type for a kind it does not know", () => {
    expect(byCode.l001!.kindLabel).toBe("Урок");
    expect(byCode.l002!.kindLabel).toBe("Отчёт");
    // The registration level is an `external_event`; the plan calls it «задание».
    expect(byCode.l003!.kindLabel).toBe("Задание");
    expect(byCode.l004!.kindLabel).toBe("Точка сборки");
    expect(byCode.l005!.kind).toBeNull();
    expect(byCode.l005!.kindLabel).toBe("Внешнее событие");
  });

  it("a level the program has not opened is locked, «Готовится», and not a route", () => {
    for (const code of ["l004", "l005"]) {
      const closed = byCode[code]!;
      expect(closed.inProduction).toBe(true);
      expect(closed.state).toBe("locked");
      expect(closed.lockReason).toBe("inactive");
      expect(closed.stateLabel).toBe("Готовится");
      expect(closed.routeAccessible).toBe(false);
    }
    // …even when it is an external-event level: it is not waiting for a partner.
    expect(byCode.l005!.lockReason).not.toBe("external");
  });

  it("counts what is open apart from what is defined", () => {
    expect(view.progress.totalLevels).toBe(5);
    expect(view.progress.openLevels).toBe(3);
    expect(view.progress.completedLevels).toBe(3);
  });

  it("a report the platform accepts by itself is not «Проверка ментором»", () => {
    expect(byCode.l002!.completionMethod).toBe("formal-report");
    expect(byCode.l002!.completionSource).toBe("self");
    expect(byCode.l002!.completionSourceLabel).toBe("Самостоятельно");
  });
});

describe("toAcademyCurriculumView (candidate / unavailable)", () => {
  it("candidate exposes curriculum but no modules/progress", () => {
    const view = toAcademyCurriculumView({ kind: "candidate", curriculum: { code: "ata-v2", name: "ATA", versionNumber: 1, status: "published", effectiveFrom: null, publishedAt: null, moduleCount: 3, levelCount: 12 }, enrollment: null } as BackendCurriculumRead);
    expect(view.state).toBe("candidate");
    if (view.state === "candidate") expect(view.modules).toEqual([]);
  });

  it("unavailable carries the reason", () => {
    const view = toAcademyCurriculumView({ kind: "unavailable", reason: "no_published_version" } as BackendCurriculumRead);
    expect(view).toEqual({ state: "unavailable", reason: "no_published_version" });
  });
});

describe("findLevel / buildLevelDetail", () => {
  const view = toAcademyCurriculumView(enrolledRead());

  it("finds a level by stable code", () => {
    expect(findLevel(view, "l002")?.level.title).toBe("L2");
    expect(findLevel(view, "nope")).toBeNull();
  });

  it("builds detail with prerequisites and forward nav only to accessible next", () => {
    const detail = buildLevelDetail(view, "l002", mapLevelContent(null, "not_configured"));
    expect(detail?.summary.levelCode).toBe("l002");
    expect(detail?.navigation.previousLevelCode).toBe("l001");
    // next (l003) is locked -> not exposed as forward nav
    expect(detail?.navigation.nextLevelCode).toBeNull();
    expect(detail?.content.available).toBe(false);
    expect(detail?.content.unavailableReason).toBe("not_configured");
  });
});
