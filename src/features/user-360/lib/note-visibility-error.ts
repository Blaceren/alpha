/**
 * Safe user-facing text for a failed note visibility change (Phase 1B5-C).
 *
 * Same guarantee, and the same reason, as `note-edit-error.ts`/`note-pin-error.ts`
 * (D-62): `CrmError.message` is developer diagnostics — English, naming internals
 * ("Note changed since it was read.", "Note is not editable.") — and it must never
 * reach a screen. A narrow visibility mapper rather than a reused one, because the
 * copy differs: a visibility conflict reads differently from a body or pin one.
 *
 * A total `Record<CrmErrorCode, string>` rather than a switch with a default, so a
 * new union member fails to compile here instead of silently rendering a fallback.
 *
 * Nothing here interpolates a note id, an audit id, an employee id, an idempotency
 * key, `updatedAt`, a note body or a visibility value — a failure explains what to
 * do next, not what was involved.
 */
import type { CrmErrorCode } from "@/data/contracts/result";
import { NOTE_VISIBILITY_EDIT_LABEL } from "@/config/labels";

export const NOTE_VISIBILITY_ERROR_MESSAGE: Record<CrmErrorCode, string> = {
  // Permission refusal is `unauthorized`; the project has no `forbidden` code (D-56).
  // Covers both a role without edit rights AND another employee's note — the control
  // is only offered for the actor's own authored notes (D-92), so this is defensive.
  unauthorized: "Доступ к этой заметке нельзя изменить",
  not_found: "Заметка больше недоступна",
  // The editor only ever sends a real note id and a real visibility, so this means
  // the UI and provider disagreed — an unchanged or immutable note.
  invalid_input: "Не удалось изменить доступ к заметке",
  conflict: NOTE_VISIBILITY_EDIT_LABEL.conflict,
  internal: "Локальное сохранение недоступно. Попробуйте ещё раз",
  rate_limited: "Слишком много запросов. Попробуйте позже.",
  upstream_unavailable: "Источник данных недоступен. Попробуйте ещё раз",
  stale_data: "Данные устарели. Обновите страницу.",
};

export function noteVisibilityErrorMessage(code: CrmErrorCode | undefined): string {
  return code ? NOTE_VISIBILITY_ERROR_MESSAGE[code] : NOTE_VISIBILITY_ERROR_MESSAGE.internal;
}
