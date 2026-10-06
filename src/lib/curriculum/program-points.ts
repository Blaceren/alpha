import type {
  AcademyCurriculumView,
  AcademyLevelSummary,
  AcademyModuleSummary,
} from "@/lib/curriculum/academy-view";
import { deriveNextAction } from "@/lib/curriculum/next-action";

/**
 * THE PROGRAM AS POINTS — one point per level, in the learner's own program.
 *
 * Home draws it as a line and Profile bends it into a ring (2026-10-03, the
 * owner's «наполни внутреннюю главную … так же сделай с профилем»), so both
 * read it from here and cannot disagree about where the learner stands.
 *
 * NOTHING IS DECIDED HERE THAT THE BACKEND ALREADY DECIDED. A point is done
 * when the level says `completed`, preparing when the program defined it and
 * has not opened it, and the current one is the level the canonical next
 * action concerns — the same decision Home's priority and Path's focus read.
 * No XP arithmetic, no level-number arithmetic, no amounts.
 */
export type ProgramPointState = "done" | "current" | "ahead" | "preparing";

export type ProgramPoint = {
  readonly levelCode: string;
  readonly order: number;
  readonly title: string;
  readonly kindLabel: string;
  readonly state: ProgramPointState;
  /** What the level gives on completion, as the program defines it. */
  readonly xpReward: number;
  /** The level page, where the learner may open it; null where it is closed. */
  readonly href: string | null;
  /**
   * The level page's address whatever its state. Home's «Начать» leads there
   * from the level the learner stands on even while it is being prepared —
   * the owner's rule since 2026-10-06 (as on Path); that page says so.
   */
  readonly pageHref: string;
};

export type ProgramModule = {
  readonly moduleCode: string;
  readonly order: number;
  readonly title: string;
  readonly chapter: { readonly number: number; readonly title: string } | null;
  readonly points: readonly ProgramPoint[];
  readonly completed: number;
};

export type ProgramPosition = {
  readonly modules: readonly ProgramModule[];
  /** The level in front of the learner, or null when every open level is done. */
  readonly current: { readonly point: ProgramPoint; readonly module: ProgramModule } | null;
  /** The module the learner is in — the current one's, else the first unfinished, else the last. */
  readonly focusModule: ProgramModule | null;
  readonly completed: number;
  readonly total: number;
  /** Levels the program has opened; less than `total` while a tail is being produced. */
  readonly open: number;
  /** Total XP, where the Backend reports it. */
  readonly xp: number | null;
};

export type EnrolledView = Extract<AcademyCurriculumView, { state: "enrolled" | "completed" }>;

function pointOf(level: AcademyLevelSummary, currentCode: string | null): ProgramPoint {
  const state: ProgramPointState =
    level.state === "completed"
      ? "done"
      : level.levelCode === currentCode
        ? "current"
        : level.inProduction
          ? "preparing"
          : "ahead";
  return {
    levelCode: level.levelCode,
    order: level.order,
    title: level.title,
    kindLabel: level.kindLabel,
    state,
    xpReward: level.xpReward,
    href: level.routeAccessible ? level.href : null,
    pageHref: level.href,
  };
}

function moduleOf(module: AcademyModuleSummary, currentCode: string | null): ProgramModule {
  const points = module.levels.map((level) => pointOf(level, currentCode));
  return {
    moduleCode: module.moduleCode,
    order: module.order,
    title: module.title,
    chapter: module.chapter,
    points,
    completed: points.filter((point) => point.state === "done").length,
  };
}

export function programPosition(view: EnrolledView): ProgramPosition {
  const action = deriveNextAction(view);
  const levels = view.modules.flatMap((module) => module.levels);
  const candidate = action.level?.levelCode ?? view.progress.currentLevelCode ?? null;
  const front = levels.find((level) => level.levelCode === candidate) ?? null;
  /* A finished level, or one the program has not opened, is not "in front of"
     anyone: the learner has done every open level and the line says so. */
  const currentCode = front && front.state !== "completed" && !front.inProduction ? front.levelCode : null;

  const modules = view.modules.map((module) => moduleOf(module, currentCode));
  let current: ProgramPosition["current"] = null;
  for (const group of modules) {
    const point = group.points.find((candidatePoint) => candidatePoint.state === "current");
    if (point) {
      current = { point, module: group };
      break;
    }
  }
  /* With every open level done, the module in focus is the one the program
     opens next — the first that is still ahead or still being prepared — and
     not simply the last one. */
  const focusModule =
    current?.module ??
    modules.find((module) => module.points.some((point) => point.state === "ahead")) ??
    modules.find((module) => module.points.some((point) => point.state === "preparing")) ??
    modules[modules.length - 1] ??
    null;

  return {
    modules,
    current,
    focusModule,
    completed: view.progress.completedLevels,
    total: view.progress.totalLevels,
    open: view.progress.openLevels,
    xp: view.progress.xp.available ? view.progress.xp.currentXp : null,
  };
}
