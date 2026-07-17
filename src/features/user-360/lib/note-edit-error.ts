/**
 * Safe user-facing text for a failed note body edit (Phase 1B4-E).
 *
 * Same guarantee, and the same reason, as `note-error.ts`/`note-pin-error.ts`
 * (D-62): `CrmError.message` is developer diagnostics — English, naming internals
 * ("Note body changed since it was read.", "Note is not editable.") — and it must
 * never reach a screen. A narrow edit mapper rather than a reused note mapper,
 * because the copy differs: an edit conflict and an edit refusal read differently
 * from adding or pinning a note.
 *
 * A total `Record<CrmErrorCode, string>` rather than a switch with a default: a new
 * member of the union then fails to compile here instead of silently rendering a
 * fallback.
 *
 * Nothing in this map interpolates a note id, an audit id, an employee id, an
 * idempotency key, `updatedAt` or a note body (old or new) — a failure explains
 * what to do next, not what was involved.
 */
import type { CrmErrorCode } from "@/data/contracts/result";
import { NOTE_EDIT_LABEL } from "@/config/labels";

export const NOTE_EDIT_ERROR_MESSAGE: Record<CrmErrorCode, string> = {
  // Permission refusal is `unauthorized`; the project has no `forbidden` code (D-56).
  // Covers both a role that cannot edit notes AND an attempt to edit another
  // employee's note — the control is only offered for the actor's own authored
  // notes (D-82), so this is reached only defensively.
  unauthorized: "Эту заметку нельзя редактировать",
  not_found: "Заметка больше недоступна",
  // The editor only ever sends the note's real id and a changed body, so this means
  // the UI and provider disagreed — our bug, or an unchanged/immutable note.
  invalid_input: "Не удалось сохранить изменения — проверьте текст",
  conflict: NOTE_EDIT_LABEL.conflict,
  internal: "Локальное сохранение недоступно. Попробуйте ещё раз",
  rate_limited: "Слишком много запросов. Попробуйте позже.",
  upstream_unavailable: "Источник данных недоступен. Попробуйте ещё раз",
  stale_data: "Данные устарели. Обновите страницу.",
};

export function noteEditErrorMessage(code: CrmErrorCode | undefined): string {
  return code ? NOTE_EDIT_ERROR_MESSAGE[code] : NOTE_EDIT_ERROR_MESSAGE.internal;
}
