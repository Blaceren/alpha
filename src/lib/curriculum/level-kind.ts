/**
 * The level's KIND, as the program's author names it (PROGRAM STRUCTURE,
 * 2026-10-02).
 *
 * WHY THIS IS NOT `level-type.ts`. The Backend type says which owner may
 * complete a level, and that vocabulary is the platform's: the registration
 * level is an `external_event`, a lesson without a test and a practical
 * document are both `lesson`. The owner's plan of the program speaks a different
 * language — «урок», «задание», «отчёт», «практика», «точка сборки» — and that is
 * the word a learner should read beside a level's number. The Backend carries it
 * as `LevelDefinition.presentationKind` and this module maps it, closed and
 * fail-soft: a kind this build does not know is `null`, and the caller falls
 * back to the type's own label rather than echoing an unknown word.
 *
 * PRESENTATION ONLY. Nothing may branch on a kind to decide what a level
 * requires; `completion-method.ts` does that.
 */
export type AcademyLevelKind = "lesson" | "task" | "report" | "practice" | "assembly";

export const LEVEL_KIND_LABEL: Record<AcademyLevelKind, string> = {
  lesson: "Урок",
  task: "Задание",
  report: "Отчёт",
  practice: "Практика",
  assembly: "Точка сборки",
};

export function mapLevelKind(raw: unknown): AcademyLevelKind | null {
  return typeof raw === "string" && raw in LEVEL_KIND_LABEL ? (raw as AcademyLevelKind) : null;
}

/** The word shown beside the level number: the author's kind, else the type's label. */
export function levelKindLabel(kind: AcademyLevelKind | null, typeLabel: string): string {
  return kind ? LEVEL_KIND_LABEL[kind] : typeLabel;
}
