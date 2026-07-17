/**
 * Safe user-facing text for a failed owner operation.
 *
 * Same guarantee, and the same reason, as `note-error.ts` (D-62): `CrmError.message`
 * is developer diagnostics — English, naming internals ("Mock overlay could not be
 * persisted.", "Primary owner changed since it was read.") — and it must never reach
 * a screen. The shared `ErrorState` renderer cannot be reused, because its `internal`
 * branch falls through to `error.message`.
 *
 * A total `Record<CrmErrorCode, string>` rather than a switch with a default: a new
 * member of the union then fails to compile here instead of silently rendering a
 * fallback.
 *
 * Nothing in this map interpolates an employee id, an audit id, an idempotency key or
 * a user's name — a failure explains what to do next, not who was involved.
 */
import type { CrmErrorCode } from "@/data/contracts/result";
import { OWNER_ASSIGN_LABEL } from "@/config/labels";

export const OWNER_ERROR_MESSAGE: Record<CrmErrorCode, string> = {
  // Permission refusal is `unauthorized`; the project has no `forbidden` code (D-56).
  unauthorized: OWNER_ASSIGN_LABEL.forbidden,
  not_found: "Пользователь больше недоступен",
  // The picker only ever offers candidates the provider accepts, so this means the
  // two disagreed — which is our bug, not something the employee mistyped.
  invalid_input: "Этого сотрудника нельзя назначить ответственным",
  conflict: OWNER_ASSIGN_LABEL.conflict,
  internal: "Локальное сохранение недоступно. Попробуйте ещё раз",
  rate_limited: "Слишком много запросов. Попробуйте позже.",
  upstream_unavailable: "Источник данных недоступен. Попробуйте ещё раз",
  stale_data: "Данные устарели. Обновите страницу.",
};

export function ownerErrorMessage(code: CrmErrorCode | undefined): string {
  return code ? OWNER_ERROR_MESSAGE[code] : OWNER_ERROR_MESSAGE.internal;
}
