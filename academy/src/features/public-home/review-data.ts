/**
 * THE ONE OBJECT the public home carries through its evidence — a report field
 * and its two settled readings — and the four states the review moves it
 * through.
 *
 * `DECISION_FIELD` is the real field of the real L3 assignment («Первые пять
 * demo-сделок»): `trade3-pre-trade-reason`, graded by the rubric's own
 * criterion — named as the product names that field since 2026-10-06 (owner:
 * Trade Card «Основание входа в сделку», the journal's «Основание»; it was
 * «Причина входа до сделки» / «Причина до сделки»). The weak and strong
 * readings are authored for this page; the tests hold that the strong one is
 * the same string in `#decide` and in the evidence, and that acceptance never
 * reads as a financial win.
 *
 * The stage titles are the product's own words for the learner: «Версия N
 * отправлена», «Получен разбор», «Работа принята», «Наставник запросил
 * доработку» — see `report-status-panel.tsx` and `level-report.tsx`.
 */

export const DECISION_FIELD = "Основание входа в сделку";
export const DECISION_UNSET = "Ещё не сформулировано";
export const DECISION_WEAK = "Вошёл, потому что показалось, что цена развернётся.";
export const DECISION_STRONG =
  "До сделки зафиксировал условие: вход только после подтверждения заранее " +
  "отмеченного уровня. Дождался его выполнения и не менял план во время сделки.";

/** The rubric criterion the return names, and what it asks for. */
export const REVIEW_CRITERION = "Основание до сделки";
export const REVIEW_REASON = "Требуется доработка";
export const REVIEW_COMMENT = "По критерию «Основание до сделки» описано ощущение, а не условие.";
export const REVIEW_ACTION =
  "Опишите условие, которое вы определили заранее, а не ощущение в момент входа.";

export type ReviewStageId = "v1" | "feedback" | "v2" | "accepted";

export type ReviewStage = {
  readonly id: ReviewStageId;
  readonly title: string;
  /** One word for the stepper a narrow screen shows above the window. */
  readonly short: string;
  readonly note: string;
};

export const REVIEW_STAGES: ReadonlyArray<ReviewStage> = [
  {
    id: "v1",
    title: "Работа отправлена",
    short: "Отправлена",
    note: "Учащийся фиксирует решение и его основание в отчёте уровня.",
  },
  {
    id: "feedback",
    title: "Получен разбор",
    short: "Разбор",
    note: "Проверяющий возвращает работу по конкретному критерию рубрики.",
  },
  {
    id: "v2",
    title: "Замечание исправлено",
    short: "Исправлено",
    note: "Меняется то же самое место — основание решения, а не оформление.",
  },
  {
    id: "accepted",
    title: "Работа принята",
    short: "Принята",
    note: "Принятие подтверждает выполненную работу — не результат сделок.",
  },
];

export function reviewStageIndex(id: ReviewStageId): number {
  return REVIEW_STAGES.findIndex((stage) => stage.id === id);
}
