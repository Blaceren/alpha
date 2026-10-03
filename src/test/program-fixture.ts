/**
 * TEST-ONLY — a learner's program as the curriculum read hands it to Home and
 * Profile (2026-10-03). Built to the product's contract, like Path's own
 * fixtures; titles are neutral placeholders.
 *
 * `program(spec)` takes one string per module, one letter per level:
 *   d — completed · c — the level in front of the learner · a — open, ahead
 *   p — defined and not open yet (in production)
 * and an optional chapter per module.
 */
import type {
  AcademyCurriculumView,
  AcademyLevelSummary,
  AcademyModuleSummary,
} from "@/lib/curriculum/academy-view";

export type EnrolledFixture = Extract<AcademyCurriculumView, { state: "enrolled" | "completed" }>;

export function fixtureLevel(order: number, letter: string): AcademyLevelSummary {
  const code = `v5.l${String(order).padStart(3, "0")}`;
  const done = letter === "d";
  const current = letter === "c";
  const preparing = letter === "p";
  return {
    levelCode: code,
    order,
    title: `Тема ${order}`,
    shortDescription: null,
    learningObjective: "цель",
    typeInfo: { type: "lesson", label: "Урок", isCheckpoint: false, isExternal: false, supported: true },
    kind: null,
    kindLabel: "Урок",
    inProduction: preparing,
    state: done ? "completed" : current ? "available" : "locked",
    lockReason: done || current ? null : preparing ? "inactive" : "sequence",
    stateLabel: done ? "Пройден" : current ? "Доступен" : preparing ? "Готовится" : "Закрыт",
    completionSource: "learner",
    completionSourceLabel: "Проверка знаний",
    requirements: { previousLevel: null, requiredXp: 0, checkpointLevel: null },
    routeAccessible: done || current,
    actions: ["view"],
    href: `/lessons/${code}`,
    xpReward: 100,
    progressVersion: null,
    checkpoint: null,
    completionMethod: "assessment",
  } as AcademyLevelSummary;
}

export function program(
  modules: ReadonlyArray<{ levels: string; chapter?: { number: number; title: string } }>,
  options: { xp?: number | null; tools?: EnrolledFixture["toolAccess"] } = {},
): EnrolledFixture {
  let order = 0;
  const built: AcademyModuleSummary[] = modules.map((spec, index) => {
    const levels = [...spec.levels].map((letter) => fixtureLevel(++order, letter));
    return {
      moduleCode: `m${String(index + 1).padStart(2, "0")}`,
      order: index + 1,
      title: `Модуль ${index + 1}`,
      description: null,
      learningObjective: "цель модуля",
      status: "active",
      chapter: spec.chapter ?? null,
      levels,
      progress: { total: levels.length, completed: levels.filter((l) => l.state === "completed").length },
    } as AcademyModuleSummary;
  });
  const all = built.flatMap((m) => m.levels);
  const current = all.find((l) => l.state === "available") ?? null;
  return {
    state: "enrolled",
    toolAccess: options.tools ?? null,
    curriculum: { curriculumCode: "ata-v2", curriculumVersion: 5, title: "Программа", status: "published", publishedAt: null },
    modules: built,
    progress: {
      currentLevelCode: current?.levelCode ?? null,
      currentModuleCode: current ? built.find((m) => m.levels.includes(current))!.moduleCode : null,
      nextAvailableLevelCode: null,
      completedLevels: all.filter((l) => l.state === "completed").length,
      totalLevels: all.length,
      openLevels: all.filter((l) => !l.inProduction).length,
      xp:
        options.xp === null || options.xp === undefined
          ? { available: false }
          : { available: true, currentXp: options.xp, nextLevelRequiredXp: null, xpRemaining: 0 },
      updatedAt: null,
    },
  } as EnrolledFixture;
}

/** The released 30-level program at level 4: three done, L4 open, L5–14 ahead, L15–30 in production. */
export function levelFourProgram(options: { xp?: number | null; tools?: EnrolledFixture["toolAccess"] } = {}): EnrolledFixture {
  const one = { number: 1, title: "Основы и первые реальные сделки" };
  const two = { number: 2, title: "Чтение графика" };
  return program(
    [
      { levels: "dddca", chapter: one },
      { levels: "aaaa", chapter: one },
      { levels: "aaaaa", chapter: one },
      { levels: "ppppp", chapter: two },
      { levels: "ppppp", chapter: two },
      { levels: "pppppp", chapter: two },
    ],
    { xp: 300, ...options },
  );
}
