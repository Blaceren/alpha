import type { AcademyLevelDetail, AcademyLevelSummary } from "@/lib/curriculum/academy-view";

/**
 * THE READER — availability, boundary and the copy that belongs to the surface.
 *
 * The frozen Reader distinguishes five reasons a material may not be readable,
 * and it never collapses them into one. That distinction is the whole point: "no
 * material by nature", "not published", "not yours yet", "cannot be shown right
 * now" and "no such page" ask completely different things of the learner, and
 * only one of them is worth retrying.
 */
export type AvailabilityClass = "nature" | "notpublished" | "locked" | "cannotshow" | "invalid";

export type ExitId = "level" | "lessons" | "path";

export const EXIT_LABEL: Record<ExitId, string> = {
  level: "Страница уровня",
  lessons: "Уроки",
  path: "Путь",
};

export const AVAILABILITY: Record<
  AvailabilityClass,
  { heading: string; text: string; exits: ExitId[] }
> = {
  nature: {
    heading: "У этого уровня нет учебного материала",
    text: "Это контрольная точка: её работа выполняется на странице уровня, а не в материалах. Учебного текста у таких уровней не бывает.",
    exits: ["level", "lessons"],
  },
  notpublished: {
    heading: "Материал не опубликован",
    text: "Для этого уровня учебный текст пока не опубликован. Состояние уровня и его задание — на странице уровня.",
    exits: ["level", "lessons"],
  },
  locked: {
    heading: "Материал ещё не открыт",
    text: "Этот уровень дальше вашей текущей позиции в программе. Материал откроется вместе с уровнем — продолжить программу можно на странице «Путь».",
    exits: ["path", "lessons"],
  },
  cannotshow: {
    heading: "Материал сейчас не открывается",
    text: "Не получилось показать материал. Это временная неполадка — попробуйте обновить страницу чуть позже. Доступ к уровню не изменился.",
    exits: ["level", "lessons"],
  },
  invalid: {
    heading: "Такой страницы нет",
    text: "Адрес не указывает на материал программы. Вернитесь к списку материалов.",
    exits: ["lessons"],
  },
};

/**
 * Which availability class this level is in, from canonical facts only.
 *
 * ORDER MATTERS AND IS NOT ARBITRARY. A checkpoint has no material BY NATURE —
 * that is true whatever the content payload says, and telling a learner a
 * checkpoint's text is "not published" would promise text that will never
 * exist. A locked level comes next, because "not yours yet" outranks anything
 * about publication: a level the learner cannot reach must never disclose
 * whether its material exists.
 */
export function availabilityOf(detail: AcademyLevelDetail): AvailabilityClass | null {
  const { summary, content } = detail;
  if (summary.typeInfo.isCheckpoint) return "nature";
  if (content.unavailableReason === "locked" || content.unavailableReason === "not_enrolled") {
    return "locked";
  }
  if (summary.state === "locked") return "locked";
  if (content.unavailableReason === "not_configured") return "notpublished";
  if (!content.available || !content.body) return "cannotshow";
  return null;
}

/**
 * The material's closing boundary. Four classes, and each says a different true
 * thing about where the learner now stands relative to the level's own work.
 */
export type BoundaryClass = "act" | "revisit" | "waiting" | "none";

export const BOUNDARY_TEXT: Record<BoundaryClass, string> = {
  act: "Материал закончился. Задание этого уровня живёт на странице уровня.",
  revisit:
    "Материал закончился. Уровень уже завершён — его задание доступно для просмотра на странице уровня.",
  waiting:
    "Работа по этому уровню отправлена на проверку. Материал остаётся доступным в любое время.",
  none: "Материал закончился.",
};

/** The action label for the level's own completion method. */
export const HANDOFF_ACTION: Record<string, string> = {
  assessment: "Открыть задание уровня",
  manual: "Открыть задание уровня",
  "mentor-review": "Открыть страницу проверки",
  report: "Открыть отчёт",
};

export function boundaryOf(summary: AcademyLevelSummary): BoundaryClass {
  if (summary.state === "completed") return "revisit";
  if (summary.state === "pending_review") return "waiting";
  if (summary.state === "in_progress" || summary.state === "available") return "act";
  return "none";
}

export const BOUNDARY_LABEL = "КОНЕЦ МАТЕРИАЛА";
export const QUIET_RETURN = "Вернуться к уровню";
export const OBJECTIVE_LABEL = "Чему учит материал";
export const TOC_LABEL = "Структура материала";
export const STRIP_BUTTON = "Структура";
export const SAVE_FAILED_NOTE = "Не удалось сохранить отметку. Материал остаётся доступным.";

/**
 * The learner's position in the material, as the Backend owns it.
 *
 * `revision` is the optimistic-concurrency token: a save carries the revision it
 * believed it was updating, and the server refuses a stale one rather than
 * overwriting a newer position from another tab.
 */
export type ReadingState = {
  readonly revision: number;
  readonly completedSections: readonly string[];
  readonly activeSectionCode: string | null;
};
