import { describe, expect, it } from "vitest";
import {
  buildLessonsLibraryModel,
  effectiveProgress,
  kindLabel,
  moduleCodeFor,
  parseModuleCode,
  resolveSelectedModule,
  MODULE_QUERY_PARAM,
} from "@/features/lessons-library/model/lessons-library-model";
import { CURRICULUM } from "@/data/curriculum/fixture";
import { getPathProgress } from "@/features/path/model/path-state";
import {
  emptyLessonProgress,
  withCompletedLevel,
} from "@/features/lesson/model/lesson-session-progress";

const marker = getPathProgress("active");
const empty = emptyLessonProgress();

function build(overrides: { moduleParam?: unknown; session?: typeof empty } = {}) {
  return buildLessonsLibraryModel({
    moduleParam: overrides.moduleParam,
    marker,
    session: overrides.session ?? empty,
  });
}

describe("curriculum scale", () => {
  it("projects exactly 20 modules and 100 levels", () => {
    const model = build();
    expect(model.modules).toHaveLength(20);
    expect(model.totalModules).toBe(20);
    expect(model.totalLevels).toBe(100);
  });

  it("never mutates the curriculum fixture", () => {
    const before = JSON.stringify(CURRICULUM);
    build();
    build({ moduleParam: "module.07" });
    build({ session: withCompletedLevel(empty, 18) });
    expect(JSON.stringify(CURRICULUM)).toBe(before);
  });

  it("is deterministic: the same inputs give an equal model", () => {
    expect(build()).toEqual(build());
    expect(build({ moduleParam: "module.09" })).toEqual(build({ moduleParam: "module.09" }));
  });
});

describe("module codes", () => {
  it("uses the curriculum's own canonical code shape", () => {
    expect(moduleCodeFor(4)).toBe("module.04");
    expect(moduleCodeFor(20)).toBe("module.20");
    // the projector must not invent a second identifier
    for (const mod of CURRICULUM.modules) {
      expect(moduleCodeFor(mod.index)).toBe(mod.code);
    }
  });

  it("parses only canonical codes in range", () => {
    expect(parseModuleCode("module.04")).toBe(4);
    expect(parseModuleCode("module.01")).toBe(1);
    expect(parseModuleCode("module.20")).toBe(20);
    for (const bad of [
      "module.21",
      "module.00",
      "module.4",
      "module.004",
      "4",
      "",
      "MODULE.04",
      "module.0x",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(parseModuleCode(bad)).toBeNull();
    }
  });

  it("exposes the query key as ordinary user state", () => {
    expect(MODULE_QUERY_PARAM).toBe("module");
  });
});

describe("selected module", () => {
  it("defaults to the user's current module from the shared marker", () => {
    // марker = level 18 → module 04, derived, never hardcoded in a component
    expect(resolveSelectedModule(undefined, marker)).toEqual({ index: 4, isFallback: false });
    expect(build().selected.index).toBe(4);
    expect(build().currentModuleIndex).toBe(4);
  });

  it("honours a valid module code", () => {
    const model = build({ moduleParam: "module.09" });
    expect(model.selected.index).toBe(9);
    expect(model.isModuleFallback).toBe(false);
    expect(model.selected.title).toBe("Первая стратегия");
  });

  it("falls back to the current module for an invalid code, flagging the fallback", () => {
    for (const bad of ["module.99", "nope", "", "../../etc", "<script>", "module.4"]) {
      const model = build({ moduleParam: bad });
      // "" is treated as absent, everything else is an explicit fallback
      expect(model.selected.index).toBe(4);
      expect(model.isModuleFallback).toBe(bad !== "");
    }
  });

  it("marks exactly one module as selected", () => {
    const model = build({ moduleParam: "module.11" });
    expect(model.modules.filter((m) => m.isSelected)).toHaveLength(1);
    expect(model.modules.find((m) => m.isSelected)?.index).toBe(11);
    expect(model.modules.filter((m) => m.isCurrent)).toHaveLength(1);
    expect(model.modules.find((m) => m.isCurrent)?.index).toBe(4);
  });

  it("selecting a module never changes progression", () => {
    const here = build();
    const far = build({ moduleParam: "module.18" });
    expect(far.currentModuleIndex).toBe(here.currentModuleIndex);
    expect(far.continueStep).toEqual(here.continueStep);
    // and a far module exposes no openable level
    expect(far.selected.levels.every((l) => l.href === null)).toBe(true);
    expect(far.selected.hasAnyAction).toBe(false);
  });
});

describe("canonical scenario — module 04", () => {
  it("reads its titles and description from the fixture", () => {
    const model = build();
    expect(model.selected.title).toBe("Чтение графика");
    expect(model.selected.description).toBe(
      "Свечи, тренд и диапазон, уровни поддержки и сопротивления, разметка.",
    );
    expect(model.selected.startLevel).toBe(16);
    expect(model.selected.endLevel).toBe(20);
    expect(model.selected.levels.map((l) => l.title)).toEqual([
      "Свечи",
      "Тренд и диапазон",
      "Поддержка и сопротивление",
      "Разметка графика",
      "Контрольная точка $200",
    ]);
  });

  it("shows progress 2 of 5 before anything is completed in the session", () => {
    const model = build();
    expect(model.selected.completedCount).toBe(2);
    expect(model.selected.totalCount).toBe(5);
  });

  it("derives level states from the existing state models", () => {
    const [l16, l17, l18, l19, l20] = build().selected.levels;
    expect(l16!.state).toBe("completed");
    expect(l16!.statusLabel).toBe("Завершён");
    expect(l16!.actionLabel).toBe("Пересмотреть");
    expect(l17!.state).toBe("completed");

    expect(l18!.state).toBe("current");
    expect(l18!.statusLabel).toBe("Текущий урок");
    expect(l18!.href).toBe("/lessons/level.018");

    // Путь calls 19 "available" (next in line); a lesson it is NOT — the
    // availability resolver is the authority here
    expect(l19!.state).toBe("locked");
    expect(l19!.statusLabel).toBe("Откроется после уровня 18");
    expect(l19!.href).toBeNull();
    expect(l19!.kindLabel).toBe("Практическое задание");
    expect(l19!.artifact).toBe("Разметка 3 графиков");

    expect(l20!.state).toBe("checkpoint");
    expect(l20!.statusLabel).toBe("Граница модуля");
    expect(l20!.href).toBeNull();
  });

  it("offers level 18 as the one dominant continue step", () => {
    const step = build().continueStep;
    expect(step).not.toBeNull();
    expect(step!.levelNumber).toBe(18);
    expect(step!.title).toBe("Поддержка и сопротивление");
    expect(step!.moduleIndex).toBe(4);
    expect(step!.moduleTitle).toBe("Чтение графика");
    expect(step!.href).toBe("/lessons/level.018");
    expect(step!.kindLabel).toBe("Видео-урок и тест");
  });
});

describe("duration honesty", () => {
  it("shows a duration only for level 18, the one authored lesson", () => {
    const withDuration = CURRICULUM.modules.flatMap((mod) =>
      buildLessonsLibraryModel({
        moduleParam: moduleCodeFor(mod.index),
        marker,
        session: empty,
      }).selected.levels.filter((l) => l.durationLabel !== null),
    );
    expect(withDuration.map((l) => l.number)).toEqual([18]);
    expect(withDuration[0]!.durationLabel).toBe("8:00");
  });

  it("puts the same real duration on the continue step", () => {
    expect(build().continueStep!.durationLabel).toBe("8:00");
  });
});

describe("kind labels", () => {
  it("labels every curriculum kind exactly once, from one owner", () => {
    expect(kindLabel("task")).toBe("Задание");
    expect(kindLabel("video-test")).toBe("Видео-урок и тест");
    expect(kindLabel("report")).toBe("Отчёт");
    expect(kindLabel("practical")).toBe("Практическое задание");
    expect(kindLabel("checkpoint")).toBe("Контрольная точка");
  });
});

describe("checkpoint — financial privacy", () => {
  const checkpoint = () => build().selected.levels.at(-1)!;

  it("states the target and what it opens, nothing else", () => {
    const cp = checkpoint();
    expect(cp.checkpoint).not.toBeNull();
    expect(cp.checkpoint!.requirement).toBe("Баланс Pocket от $200");
    expect(cp.checkpoint!.rewards).toEqual([
      "Chart Markup Tool",
      "ранг Наблюдатель IV",
      "канал Разбор графиков",
    ]);
  });

  it("never leaks a balance, a remainder, a percentage or a Pocket link", () => {
    const serialised = JSON.stringify(build());
    for (const forbidden of [
      /осталось/i,
      /остаток/i,
      /ваш баланс/i,
      /текущий баланс/i,
      /депозит/i,
      /пополн/i,
      /вывод/i,
      /https?:\/\/[^"]*pocket/i,
      /XP/,
      /%/,
    ]) {
      expect(serialised).not.toMatch(forbidden);
    }
  });

  it("keeps every checkpoint across the curriculum free of an openable route", () => {
    for (const mod of CURRICULUM.modules) {
      const model = buildLessonsLibraryModel({
        moduleParam: moduleCodeFor(mod.index),
        marker,
        session: empty,
      });
      const last = model.selected.levels.at(-1)!;
      expect(last.state).toBe("checkpoint");
      expect(last.href).toBeNull();
      // \u202f = the narrow no-break space formatThresholdUsd groups thousands with
      expect(last.checkpoint!.requirement).toMatch(/^Баланс Pocket от \$[\d\u202f]+$/);
    }
  });
});

describe("session progression (D2B.1 integration)", () => {
  const afterL18 = withCompletedLevel(empty, 18);

  it("advances the marker only forward, and only for recorded completions", () => {
    expect(effectiveProgress(marker, empty).currentLevel).toBe(18);
    expect(effectiveProgress(marker, afterL18).currentLevel).toBe(19);
    // a session claiming a level the user never reached cannot move the marker
    const bogus = withCompletedLevel(empty, 55);
    expect(effectiveProgress(marker, bogus).currentLevel).toBe(18);
    // and it can never move it backwards
    const early = getPathProgress("early");
    expect(effectiveProgress(early, afterL18).currentLevel).toBe(early.currentLevel);
  });

  it("switches the current step from 18 to 19 once 18 is completed", () => {
    const model = build({ session: afterL18 });
    const [, , l18, l19] = model.selected.levels;

    expect(l18!.state).toBe("completed");
    expect(l18!.statusLabel).toBe("Завершён");
    expect(l18!.actionLabel).toBe("Пересмотреть");

    expect(l19!.state).toBe("current");
    expect(l19!.statusLabel).toBe("Текущий урок");
    expect(l19!.href).toBe("/lessons/level.019");
    expect(l19!.actionLabel).toBe("Перейти к заданию");

    expect(model.continueStep!.levelNumber).toBe(19);
    expect(model.continueStep!.href).toBe("/lessons/level.019");
    expect(model.selected.completedCount).toBe(3);
  });

  it("never produces an href carrying a development scenario", () => {
    for (const session of [empty, afterL18]) {
      const model = build({ session });
      const hrefs = [
        model.continueStep?.href,
        ...model.modules.map((m) => m.href),
        ...model.selected.levels.map((l) => l.href),
      ].filter((h): h is string => typeof h === "string");

      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) expect(href).not.toContain("scenario");
    }
  });
});

describe("honest states", () => {
  it("offers no continue step when the current step is a checkpoint gate", () => {
    const model = buildLessonsLibraryModel({
      moduleParam: undefined,
      marker: getPathProgress("checkpoint"),
      session: empty,
    });
    expect(model.continueStep).toBeNull();
    expect(model.continueNote).toBe("Следующий шаг — контрольная точка · Уровень 20.");
  });

  it("offers no continue step when everything is completed", () => {
    const model = buildLessonsLibraryModel({
      moduleParam: undefined,
      marker: getPathProgress("completed"),
      session: empty,
    });
    expect(model.continueStep).toBeNull();
    expect(model.continueNote).toBe("Все 100 уровней пройдены.");
  });

  it("survives every module of the curriculum without throwing", () => {
    for (const mod of CURRICULUM.modules) {
      for (const scenario of ["active", "checkpoint", "early", "advanced", "completed"] as const) {
        expect(() =>
          buildLessonsLibraryModel({
            moduleParam: moduleCodeFor(mod.index),
            marker: getPathProgress(scenario),
            session: empty,
          }),
        ).not.toThrow();
      }
    }
  });
});
