/**
 * POCKET-REG-FINAL-INTERNAL-CORRECTION-1 (§7) — how a level gets closed, said
 * in the language the learner is reading.
 *
 * WHAT WENT WRONG. `view-model.ts` derived a `completionSource` from the level
 * type and the detail screen rendered it verbatim, so a learner on L1 read
 *
 *     Способ завершения: external_event
 *
 * — an internal enum, in the middle of Russian prose, on the one screen the
 * Pocket registration flow lands on. Every neighbouring field was already
 * localised (`Тип: Внешнее событие`, `Доступен`, `Завершён`), which is what
 * made it an omission rather than a house style.
 *
 * WHY A MAP AND NOT A REPLACEMENT AT THE CALL SITE. Six distinct values can
 * reach that screen, and a fix applied to the one that was observed would leave
 * the other five to be found the same way — by a person reading them in
 * production. The vocabulary is small, closed and derived from
 * `AcademyLevelType`, so it can be covered exhaustively here and checked
 * exhaustively by the compiler.
 *
 * THE INTERNAL ENUM IS UNCHANGED. `AcademyLevelSummary.completionSource` still
 * carries the canonical machine value, because the API payload and any
 * automation reading it are a separate contract from what a human sees. This
 * module adds a presentation field beside it rather than replacing it.
 */

/**
 * The canonical completion-source vocabulary.
 *
 * These are the VALUES of `COMPLETION_SOURCE` in `view-model.ts`, which maps
 * nine `AcademyLevelType`s onto six sources. Declared as a type so adding a
 * seventh source without a label is a compile error rather than a string that
 * reaches a learner.
 */
export type CompletionSource =
  | "external_event"
  | "financial_checkpoint"
  | "mentor_review"
  | "self"
  | "final_exam"
  | "unknown";

/**
 * Learner-facing Russian for each source.
 *
 * The wording answers the question the label asks — *how does this level get
 * closed* — rather than restating the level type, which the field directly
 * above it already shows.
 *
 * `unknown` gets real copy too. It is reachable, via the `unsupported` level
 * type, and a learner who lands on one deserves a sentence rather than the word
 * `unknown`.
 */
export const COMPLETION_SOURCE_LABEL: Record<CompletionSource, string> = {
  external_event: "Внешнее событие",
  financial_checkpoint: "Контрольная точка",
  mentor_review: "Проверка ментором",
  self: "Самостоятельно",
  final_exam: "Финальный экзамен",
  unknown: "Не определён",
};

/**
 * The label for a completion source, for a value that arrives as a plain
 * string.
 *
 * FALLS BACK TO THE "UNKNOWN" COPY, NOT TO THE RAW VALUE. Echoing an
 * unrecognised code would reintroduce exactly the defect this module exists to
 * close, and would do it precisely in the case nobody anticipated. A learner
 * seeing "Не определён" for a source this build does not know about is told
 * something true; a learner seeing `some_new_enum` is shown a bug.
 */
export function completionSourceLabel(source: string | null | undefined): string {
  if (typeof source === "string" && source in COMPLETION_SOURCE_LABEL) {
    return COMPLETION_SOURCE_LABEL[source as CompletionSource];
  }
  return COMPLETION_SOURCE_LABEL.unknown;
}
