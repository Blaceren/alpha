/**
 * Safe user-facing text for a failed note deletion (Phase 1B6).
 *
 * Same guarantee, and the same reason, as `note-visibility-error.ts`/
 * `note-edit-error.ts` (D-62): `CrmError.message` is developer diagnostics —
 * English, naming internals ("Note changed since it was read.", "Note is not
 * deletable.") — and it must never reach a screen. A narrow delete mapper rather
 * than a reused one, because the copy differs: a delete conflict reads differently
 * from a body or visibility one.
 *
 * A total `Record<CrmErrorCode, string>` rather than a switch with a default, so a
 * new union member fails to compile here instead of silently rendering a fallback.
 *
 * Nothing here interpolates a note id, an audit id, an employee id, an idempotency
 * key, `updatedAt`, a note body or a visibility value — a failure explains what to
 * do next, not what was involved.
 */
import type { CrmErrorCode } from "@/data/contracts/result";
import { NOTE_DELETE_LABEL } from "@/config/labels";

export const NOTE_DELETE_ERROR_MESSAGE: Record<CrmErrorCode, string> = {
  // Permission refusal is `unauthorized`; the project has no `forbidden` code (D-56).
  // Covers both a role without edit rights AND another employee's note — the control
  // is only offered for the actor's own authored notes (D-96), so this is defensive.
  unauthorized: "Эту заметку нельзя удалить",
  not_found: "Заметка больше недоступна",
  // The confirm only ever sends a real note id, so this means the UI and provider
  // disagreed — an immutable fixture or a non-overlay note.
  invalid_input: "Не удалось удалить заметку",
  conflict: NOTE_DELETE_LABEL.conflict,
  internal: "Локальное сохранение недоступно. Попробуйте ещё раз",
  rate_limited: "Слишком много запросов. Попробуйте позже.",
  upstream_unavailable: "Источник данных недоступен. Попробуйте ещё раз",
  stale_data: "Данные устарели. Обновите страницу.",
};

export function noteDeleteErrorMessage(code: CrmErrorCode | undefined): string {
  return code ? NOTE_DELETE_ERROR_MESSAGE[code] : NOTE_DELETE_ERROR_MESSAGE.internal;
}
