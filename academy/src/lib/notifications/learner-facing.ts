import { isVisibleNotificationType } from "@/config/feature-visibility";

/**
 * WHICH NOTIFICATIONS A LEARNER IS SHOWN (2026-10-04, launch audit).
 *
 * Two rules, one predicate for the register and for the bell's mark, so the
 * two can never disagree:
 *
 *   1. a withheld section's events are not shown (`feature-visibility.ts`,
 *      Community today);
 *   2. the broker's own events are never shown. The Backend records a
 *      notification for every Pocket postback (registration, deposit,
 *      withdrawal) and for every change of the «биржевой аккаунт», with the
 *      postback's or the provider's own words as its text — on PREPROD
 *      learners read «Получено событие биржи / Получен exchange postback:
 *      first_deposit.».
 *      The product's first rule about money is that the Academy never shows a
 *      learner's deposits, withdrawals or balance, and these rows are exactly
 *      that, in raw system words. What a broker event changes in the learner's
 *      own work (a level completed by the registration postback) is shown by
 *      the level itself.
 *
 * Nothing is deleted: the rows are filtered out of a view.
 */
const BROKER_EVENT_TYPES: ReadonlySet<string> = new Set([
  "postback_received",
  "exchange_connected",
  "exchange_rejected",
  "exchange_blocked",
]);

export function isLearnerFacingNotificationType(type: string | null | undefined): boolean {
  const name = type ?? "";
  return isVisibleNotificationType(name) && !BROKER_EVENT_TYPES.has(name);
}
