/**
 * Safe user-facing text for a failed note pin/unpin (Phase 1B4-D).
 *
 * Same guarantee, and the same reason, as `note-error.ts` (D-62): `CrmError.message`
 * is developer diagnostics — English, naming internals ("Mock overlay could not be
 * persisted.", "Note pin state changed since it was read.") — and it must never
 * reach a screen. A narrow pin mapper rather than a reused note mapper, because the
 * copy differs: pinning has no field to fix, so `invalid_input` and `conflict` read
 * differently from adding a note.
 *
 * A total `Record<CrmErrorCode, string>` rather than a switch with a default: a new
 * member of the union then fails to compile here instead of silently rendering a
 * fallback.
 *
 * Nothing in this map interpolates a note id, an audit id, an employee id, an
 * idempotency key or a note body — a failure explains what to do next, not what was
 * involved.
 */
import type { CrmErrorCode } from "@/data/contracts/result";
import { NOTE_PIN_LABEL } from "@/config/labels";

export const NOTE_PIN_ERROR_MESSAGE: Record<CrmErrorCode, string> = {
  // Permission refusal is `unauthorized`; the project has no `forbidden` code (D-56).
  // Reached only defensively — a role that cannot edit notes is never shown the
  // control at all (D-59).
  unauthorized: "Ваша роль не может закреплять заметки",
  not_found: "Заметка больше недоступна",
  // The control only ever sends the note's real id and the opposite of its current
  // state, so this means the UI and provider disagreed — our bug, not user input.
  invalid_input: "Не удалось изменить закрепление заметки",
  conflict: NOTE_PIN_LABEL.conflict,
  internal: "Локальное сохранение недоступно. Попробуйте ещё раз",
  rate_limited: "Слишком много запросов. Попробуйте позже.",
  upstream_unavailable: "Источник данных недоступен. Попробуйте ещё раз",
  stale_data: "Данные устарели. Обновите страницу.",
};

export function notePinErrorMessage(code: CrmErrorCode | undefined): string {
  return code ? NOTE_PIN_ERROR_MESSAGE[code] : NOTE_PIN_ERROR_MESSAGE.internal;
}
