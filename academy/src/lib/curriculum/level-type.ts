/**
 * Backend LevelDefinitionType -> Academy display concept.
 *
 * Exhaustive over the eight Backend types. An UNKNOWN type never defaults to
 * "lesson" — it maps to a bounded `unsupported` display so the UI degrades
 * safely instead of misrepresenting a level. No type is self-completable in
 * CI-2 (read-only); the flags below only describe how the level presents.
 */
export type BackendLevelType =
  | "external_event"
  | "lesson"
  | "scenario"
  | "practice"
  | "report"
  | "mentor_review"
  | "financial_checkpoint"
  | "final_exam";

export type AcademyLevelType =
  | "external"
  | "lesson"
  | "scenario"
  | "practice"
  | "report"
  | "mentor-review"
  | "checkpoint"
  | "final-exam"
  | "unsupported";

export type AcademyLevelTypeInfo = {
  type: AcademyLevelType;
  /** RU display label (not the only signal — never color/label-only meaning). */
  label: string;
  isCheckpoint: boolean;
  isExternal: boolean;
  /** mentor_review/report/checkpoint/external are never self-completable in the UI. */
  selfCompletableInPrinciple: boolean;
  supported: boolean;
};

const MAP: Record<BackendLevelType, AcademyLevelTypeInfo> = {
  external_event: { type: "external", label: "Внешнее событие", isCheckpoint: false, isExternal: true, selfCompletableInPrinciple: false, supported: true },
  lesson: { type: "lesson", label: "Урок", isCheckpoint: false, isExternal: false, selfCompletableInPrinciple: true, supported: true },
  scenario: { type: "scenario", label: "Сценарий", isCheckpoint: false, isExternal: false, selfCompletableInPrinciple: true, supported: true },
  practice: { type: "practice", label: "Практика", isCheckpoint: false, isExternal: false, selfCompletableInPrinciple: true, supported: true },
  report: { type: "report", label: "Отчёт", isCheckpoint: false, isExternal: false, selfCompletableInPrinciple: false, supported: true },
  mentor_review: { type: "mentor-review", label: "Проверка ментором", isCheckpoint: false, isExternal: false, selfCompletableInPrinciple: false, supported: true },
  financial_checkpoint: { type: "checkpoint", label: "Контрольная точка", isCheckpoint: true, isExternal: false, selfCompletableInPrinciple: false, supported: true },
  final_exam: { type: "final-exam", label: "Финальный экзамен", isCheckpoint: false, isExternal: false, selfCompletableInPrinciple: false, supported: true },
};

const UNSUPPORTED: AcademyLevelTypeInfo = {
  type: "unsupported",
  label: "Неподдерживаемый тип",
  isCheckpoint: false,
  isExternal: false,
  selfCompletableInPrinciple: false,
  supported: false,
};

export function mapLevelType(backendType: string): AcademyLevelTypeInfo {
  return (MAP as Record<string, AcademyLevelTypeInfo>)[backendType] ?? UNSUPPORTED;
}

/**
 * How the EXISTING Academy fixture kinds relate to Backend types (documentation
 * of the CS-1 mapping; the fixture content itself is unchanged in CI-2):
 *   task        <-> external_event
 *   video-test  <-> lesson
 *   report      <-> report
 *   practical   <-> scenario | practice
 *   checkpoint  <-> financial_checkpoint
 *   (mentor_review / final_exam have no direct fixture kind yet)
 */
export const FIXTURE_KIND_TO_BACKEND_TYPE = {
  task: "external_event",
  "video-test": "lesson",
  report: "report",
  practical: "practice",
  checkpoint: "financial_checkpoint",
} as const;
