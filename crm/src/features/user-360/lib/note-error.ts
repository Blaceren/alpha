/**
 * Safe user-facing text for a failed note operation.
 *
 * `CrmError.message` is developer diagnostics — it is written in English, it
 * names internals ("Mock overlay could not be persisted."), and it must never
 * reach a screen. The shared `ErrorState` renderer cannot be reused here for
 * exactly that reason: its `internal` branch falls through to `error.message`
 * (src/components/states/error-state.tsx), which is fine for a whole-page load
 * failure written by us and wrong for a mutation whose failures we now surface
 * inline.
 *
 * The map is a total `Record<CrmErrorCode, string>` rather than a switch with a
 * default: a new member of the union then fails to compile here instead of
 * silently rendering a fallback.
 */
import type { CrmErrorCode } from "@/data/contracts/result";
import type { NoteBodyError } from "@/domain/notes/note";
import { NOTE_BODY_MAX_LENGTH } from "@/domain/notes/note";

/**
 * Client-side mirror of the provider's body rules. The limit is read from the
 * domain constant, never retyped: two copies of "2000" would be two contracts.
 */
export const NOTE_VALIDATION_MESSAGE: Record<NoteBodyError, string> = {
  empty: "Введите текст заметки.",
  too_long: `Заметка длиннее ${NOTE_BODY_MAX_LENGTH} символов — сократите текст.`,
};

/**
 * Every code the project's `CrmErrorCode` union actually contains. Codes that
 * `addNote` does not document (rate_limited, stale_data, upstream_unavailable)
 * are still mapped: the dev demo-state switch can put the provider into
 * `errorMode`, which answers every call — mutations included — with
 * `upstream_unavailable`.
 */
export const NOTE_ERROR_MESSAGE: Record<CrmErrorCode, string> = {
  // Permission refusal is `unauthorized`; the project has no `forbidden` code (D-56).
  unauthorized: "Ваша роль не может добавлять заметки",
  not_found: "Пользователь больше недоступен",
  invalid_input: "Заметку не удалось сохранить — проверьте текст.",
  conflict: "Не удалось сохранить заметку. Попробуйте ещё раз",
  internal: "Локальное сохранение недоступно. Попробуйте ещё раз",
  rate_limited: "Слишком много запросов. Попробуйте позже.",
  upstream_unavailable: "Источник данных недоступен. Попробуйте ещё раз",
  stale_data: "Данные устарели. Обновите страницу.",
};

/** Safe text for a failed notes read. Same map — same guarantee. */
export function noteErrorMessage(code: CrmErrorCode | undefined): string {
  return code ? NOTE_ERROR_MESSAGE[code] : NOTE_ERROR_MESSAGE.internal;
}
