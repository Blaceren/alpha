import type { AcademyLevelSummary } from "@/lib/curriculum/academy-view";

/**
 * WORKSPACE — the system copy, and who owns the next transition.
 *
 * The frozen Workspace states two different things about a level and never
 * conflates them: WHAT the state is, and WHOSE move it is. The second is the one
 * that is easy to get wrong, because a learner reading "на проверке" still needs
 * to know whether they should be doing something — so the owner line is a
 * separate, explicit sentence rather than an inference.
 */
export const WS_COPY = {
  labelRequirement: "Что требуется",
  labelState: "Состояние работы",
  labelCriteria: "Что считается выполненным",
  labelHost: "Задание",
  labelMaterial: "Материал уровня",
  requirementUnstated: "Требование этого уровня не задано в программе.",
  criteriaNone: "Отдельных критериев приёмки для этого уровня автор не задал.",
  whereHere: "Работа выполняется здесь.",
  whereSubmission: "Работа выполняется в отдельной форме этого уровня.",
  whereElsewhereJournal: "Работа выполняется вне Академии — в вашем журнале.",
  whereElsewherePocket: "Работа выполняется на стороне Pocket.",
  whereElsewhereCheckpoint:
    "Условие подтверждает внешний сервис. Со стороны Академии здесь ничего не выполняется.",
  openMaterial: "Открыть материал урока",
  exitPath: "Вернуться к пути",
  exitLevel: "Вернуться к уровню",
  actionBelow: "Действие — в задании ниже.",
  noWorkspaceTitle: "У этого уровня нет рабочей области",
  noWorkspaceBody:
    "Этот уровень завершается другим способом. Откройте его на странице уровня.",
  gateTitle: "Уровень пока недоступен",
  notFoundTitle: "Уровень не найден",
  notFoundBody: "Такого уровня нет в текущей программе.",
} as const;

/** Whose move it is. Never inferred from the state line — always stated. */
export const OWNER = {
  you: "Следующий шаг за вами.",
  mentor: "Следующий шаг за наставником. От вас сейчас ничего не требуется.",
  reviewer: "Следующий шаг за проверяющим. От вас сейчас ничего не требуется.",
  provider:
    "Уровень закроется, когда Pocket подтвердит регистрацию. Вручную это отметить нельзя.",
  verification:
    "Проверку выполняет внешний сервис. Пока он недоступен, следующий модуль не открывается.",
  sequence: "Сначала нужно завершить предыдущие уровни.",
  nobody: "Уровень завершён. Здесь больше ничего не требуется.",
} as const;

export type DecisionKind = "action" | "wait" | "none";

/**
 * Whose move it is, from canonical state and completion method only.
 *
 * A `pending_review` level distinguishes the mentor from the reviewer, because
 * the frozen copy does and because they are different people to a learner: one
 * is teaching them, the other is accepting a submission.
 */
export function ownerOf(summary: AcademyLevelSummary): string {
  if (summary.state === "completed") return OWNER.nobody;
  if (summary.state === "locked") return OWNER.sequence;
  if (summary.state === "pending_review") {
    return summary.completionMethod === "mentor-review" ? OWNER.mentor : OWNER.reviewer;
  }
  if (summary.state === "checkpoint_unverified") return OWNER.verification;
  if (summary.completionMethod === "external-event") return OWNER.provider;
  return OWNER.you;
}

/**
 * Whether the page carries a decision at all.
 *
 * WAIT AND NONE RENDER NO CONTROL — not even a disabled one. A control the
 * learner cannot use is a claim that they could, and on a page whose subject is
 * "whose move is it" that claim is the exact thing the surface must not make.
 */
export function decisionOf(summary: AcademyLevelSummary): DecisionKind {
  if (summary.state === "completed") return "none";
  if (summary.state === "locked") return "none";
  if (summary.state === "pending_review" || summary.state === "checkpoint_unverified") return "wait";
  return "action";
}

/**
 * Where the work is actually done. Three values, and the frozen surface treats
 * the distinction as load-bearing: a learner who does not know whether the work
 * happens on this page, in a form, or outside the Academy entirely will look for
 * it in the wrong place.
 */
export function whereOf(summary: AcademyLevelSummary): string {
  switch (summary.completionMethod) {
    case "report":
      return WS_COPY.whereSubmission;
    case "external-event":
      return WS_COPY.whereElsewherePocket;
    case "checkpoint":
      return WS_COPY.whereElsewhereCheckpoint;
    case "manual":
      return WS_COPY.whereElsewhereJournal;
    default:
      return WS_COPY.whereHere;
  }
}
