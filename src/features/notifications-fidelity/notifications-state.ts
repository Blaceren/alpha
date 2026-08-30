import { deriveNotificationHref, type HrefSource } from "@/features/academy-experience/notifications-screen";
import { isVisibleNotificationType } from "@/config/feature-visibility";

/**
 * NOTIFICATIONS — the semantic layer, mapped from the real Backend row.
 *
 * The frozen system separates one notification into two layers, and every rule
 * below is an expression of that separation:
 *
 *   EVENT RECORD       immutable — what changed, what it relates to, when
 *   CURRENT PROJECTION mutable, source-domain-owned, ALLOWED TO BE UNKNOWN
 *                      — is this asking something now, can the learner get there
 *
 * THE PRODUCT CARRIES THE FIRST LAYER AND NOT THE SECOND. A Backend
 * `Notification` row is `{ id, type, title, message, metadata, readAt,
 * createdAt }`. There is no actionability projection on it, and there is no
 * Backend route that computes one. So this file never claims one: actionability
 * is ACTION_UNKNOWN for every row, always, and the frozen fail-closed rule then
 * does the rest —
 *
 *   "If current source-domain actionability cannot be verified, the page does
 *    not claim that action is required. The historical change truth remains in
 *    full; the current action claim is withheld."
 *
 * That is why this surface renders no Signal mark and makes no page-level
 * action statement. It is not a gap in the restoration; it is the frozen
 * design's own answer for exactly this situation, and inventing the projection
 * to light the mark up would be the one thing the contract forbids most
 * explicitly.
 */

/** The Backend's `NotificationType` enum, as deployed. */
export type NotificationTypeName =
  | "support_reply"
  | "task_report_approved"
  | "task_report_rejected"
  | "reward_granted"
  | "level_up"
  | "checkpoint_frozen"
  | "checkpoint_restored"
  | "postback_received"
  | "exchange_connected"
  | "exchange_rejected"
  | "exchange_blocked"
  | "mentor_reply"
  | "daily_reward"
  | "achievement_granted"
  | "promocode_redeemed"
  | "referral_bonus"
  | "system"
  | "community_reply"
  | "community_moderation";

/**
 * CONTEXT IDENTITY — «с чем это связано?».
 *
 * Required on every record by the item contract, and it is an IDENTITY, not
 * route or debug metadata: the shape is «область · предмет», exactly as the
 * frozen page renders it («Уровень 3 · Отчёт», «Academy · Система»).
 *
 * Every value of the deployed enum is mapped, so nothing a learner can see
 * today is affected by the suppression rule below. The map exists so that a
 * type the Academy has no approved representation for CANNOT reach the learner
 * as a raw enum, raw Backend jargon or an invented category — all three are
 * forbidden by name.
 */
const CONTEXT: Record<NotificationTypeName, string> = {
  support_reply: "Academy · Поддержка",
  task_report_approved: "Отчёт · Проверка",
  task_report_rejected: "Отчёт · Проверка",
  reward_granted: "Academy · Начисление",
  level_up: "Путь · Прогресс",
  checkpoint_frozen: "Контрольная точка",
  checkpoint_restored: "Контрольная точка",
  postback_received: "Academy · Внешнее подтверждение",
  exchange_connected: "Academy · Внешний счёт",
  exchange_rejected: "Academy · Внешний счёт",
  exchange_blocked: "Academy · Внешний счёт",
  mentor_reply: "Наставник · Ответ",
  daily_reward: "Academy · Начисление",
  achievement_granted: "Academy · Достижение",
  promocode_redeemed: "Academy · Промокод",
  referral_bonus: "Academy · Реферальная программа",
  system: "Academy · Система",
  community_reply: "Сообщество · Обсуждение",
  community_moderation: "Сообщество · Модерация",
};

/**
 * EVENT CONSEQUENCE CLASS — a property of what happened, not of what is being
 * asked now. It is immutable and belongs to the event record layer, so it is
 * derived from the type and never from progression.
 *
 * It reaches the DOM only as evidence (`data-consequence`); no rule in the
 * stylesheet reads it, and it may never become a badge.
 */
const ACTION_RELEVANT = new Set<NotificationTypeName>([
  "task_report_rejected",
  "mentor_reply",
  "support_reply",
  "checkpoint_frozen",
  "exchange_rejected",
  "exchange_blocked",
  "community_moderation",
]);

export function consequenceOf(type: NotificationTypeName): "ACTION-RELEVANT" | "AWARENESS-ONLY" {
  return ACTION_RELEVANT.has(type) ? "ACTION-RELEVANT" : "AWARENESS-ONLY";
}

export function contextIdentity(type: string): string | null {
  return CONTEXT[type as NotificationTypeName] ?? null;
}

/**
 * The handoff label, for the ONE case the product actually has a destination:
 * a Community thread the row is about.
 *
 * It is a REVIEW handoff, not an action handoff. The label describes what the
 * learner is returning to and manufactures no urgency, per the label contract —
 * and no Signal mark or action claim accompanies it, which is the structural
 * difference between the two kinds.
 *
 * A NOTE ON DESTINATION ELIGIBILITY. The frozen Phase-1 design records Community
 * as NOT admitted to its canonical destination-owner list, and says so as an
 * open hold — "recorded as an open hold, not designed around". The product has
 * since shipped that destination and Community is a protected surface of this
 * phase, so the link stays: which events may lead where is domain logic, and
 * domain logic is the product's authority, not the prototype's. The
 * disagreement is recorded rather than silently resolved either way.
 */
const HANDOFF_LABEL: Partial<Record<NotificationTypeName, string>> = {
  community_reply: "Открыть обсуждение",
  community_moderation: "Открыть обсуждение",
};

export function handoffLabel(type: string): string | null {
  return HANDOFF_LABEL[type as NotificationTypeName] ?? null;
}

/** The five destination states, never collapsed into "not available". */
export type DestinationState = "AVAILABLE" | "NO_DESTINATION_NEEDED";

export type NotificationRow = {
  id: number | string;
  type?: string | null;
  title?: string | null;
  message?: string | null;
  body?: string | null;
  readAt?: string | null;
  createdAt?: string | null;
  metadata?: unknown;
  link?: string | null;
  url?: string | null;
};

export type NotificationRecord = {
  id: string;
  consumption: "UNREAD" | "READ";
  consequence: "ACTION-RELEVANT" | "AWARENESS-ONLY";
  /** Always ACTION_UNKNOWN — see the file header. */
  actionability: "ACTION_UNKNOWN";
  destination: DestinationState;
  change: string;
  reason: string | null;
  context: string;
  time: string;
  timeMachine: string;
  handoff: { label: string; href: string } | null;
};

/**
 * SUPPRESSION OF AN UNREPRESENTABLE TYPE.
 *
 * The frozen design selects "suppress from the learner surface" for a type the
 * Academy has no approved representation for, over the alternative of a generic
 * fallback — and gives the evidence for it: the deployed payload text is
 * Backend-authored and demonstrably carries internal vocabulary, so
 * "authoritative human-readable" cannot be assumed just because a string exists.
 *
 * WHAT THIS DOES AND DOES NOT COST TODAY. Every value of the deployed enum is
 * mapped above, so no notification a learner can currently receive is
 * suppressed. The rule only ever applies to a type that arrives without a
 * representation — a not-yet-approved class or a defect — and in both cases the
 * learner is shown nothing rather than raw enum text. The learner is never told
 * an item was hidden: that is system noise, and the frozen rules say so.
 */
export function toRecord(row: NotificationRow, now: Date): NotificationRecord | null {
  const type = row.type ?? "";

  /**
   * A WITHHELD SECTION'S EVENTS ARE NOT SHOWN.
   *
   * Same mechanism as the suppression below and the same discipline: the row is
   * dropped from THIS VIEW and nothing else happens to it. It is not deleted,
   * not marked read, and no request is made about it — the Academy never writes
   * to consumption, and this phase does not start.
   *
   * The shell's unread mark filters on the same predicate, so a hidden event
   * cannot light the bell while the list it would appear in shows nothing.
   */
  if (!isVisibleNotificationType(type)) return null;

  const context = contextIdentity(type);
  if (!context) return null;

  const created = row.createdAt ? new Date(row.createdAt) : null;
  if (!created || Number.isNaN(created.getTime())) return null;

  const href = deriveNotificationHref(row as HrefSource);
  const label = handoffLabel(type);

  const statement = (row.title ?? "").trim();
  const support = (row.message ?? row.body ?? "").trim();

  return {
    id: String(row.id),
    consumption: row.readAt ? "READ" : "UNREAD",
    consequence: consequenceOf(type as NotificationTypeName),
    actionability: "ACTION_UNKNOWN",
    destination: href && label ? "AVAILABLE" : "NO_DESTINATION_NEEDED",
    change: statement || "Изменение в вашей работе",
    /* The reason line exists only where it adds something the statement does
       not already carry. A message that merely repeats the title is not a
       reason, and repeating it would be decoration. */
    reason: support && support !== statement ? support : null,
    context,
    time: humanTime(created, now),
    timeMachine: created.toISOString(),
    handoff: href && label ? { label, href } : null,
  };
}

const MONTHS = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The frozen time shape: «Сегодня, 14:20» · «Вчера, 18:10» · «12 авг, 10:15».
 *
 * Time is subordinate to meaning and never leads, so it is deliberately short.
 * `now` is a parameter rather than a call to `Date.now()` so the boundary
 * between today, yesterday and a date is testable instead of being whatever the
 * clock happened to say.
 */
export function humanTime(when: Date, now: Date): string {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);
  if (when >= startOfToday) return `Сегодня, ${hhmm(when)}`;
  if (when >= startOfYesterday) return `Вчера, ${hhmm(when)}`;
  return `${when.getDate()} ${MONTHS[when.getMonth()]}, ${hhmm(when)}`;
}

/**
 * THE PAGE-LEVEL ACTION PRESENCE.
 *
 * Three inputs, and the third renders nothing. `WITHHELD` is the answer
 * whenever actionability could not be confirmed — which, for this product, is
 * every populated register. `NONE_SCOPED` is reachable and truthful in exactly
 * one situation: there is nothing here at all, so nothing here is asking. It is
 * scope-limited and is never a completion claim about the learner's work.
 */
export type PresenceState = "PRESENT" | "NONE_SCOPED" | "WITHHELD";

export function presenceFor(request: "SUCCESS" | "LOADING" | "FAILURE", records: number): PresenceState {
  if (request !== "SUCCESS") return "WITHHELD";
  return records === 0 ? "NONE_SCOPED" : "WITHHELD";
}

/** The frozen copy, verbatim from the accepted page. */
export const COPY = {
  title: "Уведомления",
  registerLabel: "Значимые изменения",
  loadingAnnouncement: "Загрузка изменений",
  presenceNone: "Сейчас ничего не требует вашего действия в этом разделе.",
  emptyLead: "Значимых изменений пока нет — здесь появляется то, что произошло в вашей работе без вас.",
  failureLead: "Не удалось обновить список изменений.",
  failureReasonCold: "Проверьте соединение и повторите попытку.",
  failureRecovery: "Обновить",
} as const;
