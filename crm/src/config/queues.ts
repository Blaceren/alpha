/**
 * Single typed source of truth for Today queue codes, titles and queue-level
 * priority band (Phase 1B1.1 §5). Canonical code is `critical_attention`
 * (never `critical`). 13 queues total.
 */
import type { PriorityBand } from "@/domain/priority/priority";

export type TodayQueueCode =
  | "critical_attention"
  | "onboarding_attention"
  | "sla_breached"
  | "due_today"
  | "mentor_review"
  | "support_blockers"
  | "checkpoint_attention"
  | "learning_stalled"
  | "returned_users"
  | "new_funded_users"
  | "repeat_funders"
  | "communication_suppression"
  | "data_quality_issues";

/** Canonical ordered list of all queue codes (drives iteration + tests). */
export const TODAY_QUEUE_ORDER: TodayQueueCode[] = [
  "critical_attention",
  "onboarding_attention",
  "sla_breached",
  "due_today",
  "mentor_review",
  "support_blockers",
  "checkpoint_attention",
  "learning_stalled",
  "returned_users",
  "new_funded_users",
  "repeat_funders",
  "communication_suppression",
  "data_quality_issues",
];

export const QUEUE_TITLE: Record<TodayQueueCode, string> = {
  critical_attention: "Критическое внимание",
  onboarding_attention: "Онбординг",
  sla_breached: "Нарушен SLA",
  due_today: "Срок сегодня",
  mentor_review: "Mentor-проверка",
  support_blockers: "Support-блокеры",
  checkpoint_attention: "Checkpoint",
  learning_stalled: "Обучение остановилось",
  returned_users: "Вернувшиеся",
  new_funded_users: "Новые FTD",
  repeat_funders: "Repeat funders",
  communication_suppression: "Снизить коммуникации",
  data_quality_issues: "Качество данных",
};

export const QUEUE_PRIORITY: Record<TodayQueueCode, PriorityBand> = {
  critical_attention: "critical",
  onboarding_attention: "normal",
  sla_breached: "high",
  due_today: "high",
  mentor_review: "high",
  support_blockers: "critical",
  checkpoint_attention: "high",
  learning_stalled: "normal",
  returned_users: "normal",
  new_funded_users: "normal",
  repeat_funders: "low",
  communication_suppression: "normal",
  data_quality_issues: "high",
};

/** Queues where financial values are not meaningful and must not be shown. */
export const QUEUES_WITHOUT_FINANCIALS: ReadonlySet<TodayQueueCode> = new Set([
  "onboarding_attention",
]);

/* --------------------------------------------- Today workspace (Phase 1B3) */

/**
 * A queue code, viewed as the BASIS for a user being in Today — the answer to
 * "why is this person in my queue". The 13 codes above already encode exactly
 * that, so Today reuses them rather than inventing a parallel reason taxonomy;
 * they also become the "тип основания" filter.
 *
 * Basis (why) and section (how urgent) are deliberately separate axes: one user
 * can hold several bases at once, but lands in exactly ONE section.
 */
export type TodayBasisCode = TodayQueueCode;

/**
 * Bases that admit a user to the Today queue.
 *
 * Excluded: `new_funded_users` and `repeat_funders`. Both are VALUE SEGMENTS
 * ("who this user is"), not work ("what needs doing") — a repeat funder with no
 * blocker, no SLA and no stalled progress needs nothing today. They are already
 * served by the Segments domain (`repeat_funders`, `frequent_repeat_funders` in
 * segments.ts) and the Users workspace, so admitting them here would only pad
 * the queue and make calm users compete with real work (Phase 1B3 §7).
 */
export const TODAY_ATTENTION_BASES: readonly TodayBasisCode[] = [
  "critical_attention",
  "sla_breached",
  "due_today",
  "support_blockers",
  "mentor_review",
  "checkpoint_attention",
  "onboarding_attention",
  "learning_stalled",
  "data_quality_issues",
  "communication_suppression",
  "returned_users",
];

/** Value-segment codes that are NOT grounds for attention. Kept for the record. */
export const TODAY_SEGMENT_BASES: readonly TodayBasisCode[] = ["new_funded_users", "repeat_funders"];

/**
 * Bases that RESTATE something the row already shows on its own.
 *
 * `critical_attention` means "priority is critical" — the priority badge says
 * that. `sla_breached` / `due_today` mean "a deadline is here" — the due chip
 * says that, with the timing. Rendering them again as reason chips is the same
 * fact twice (§10), so they are dropped from the "ещё основания" list. They stay
 * eligible as the headline for a user who has no substantive basis at all, and
 * they remain first-class filter values — "покажи всех с нарушенным SLA" is a
 * real question even though the chip would be redundant.
 */
export const TODAY_DERIVED_BASES: ReadonlySet<TodayBasisCode> = new Set([
  "critical_attention",
  "sla_breached",
  "due_today",
]);

/**
 * Operational sections of the Today queue: how urgent, not why. Ordered most
 * urgent first; a user appears in exactly one (see canonical placement in
 * `domain/today/builder.ts`).
 */
export type TodaySectionKey = "overdue" | "critical_now" | "today" | "watch";

export const TODAY_SECTION_ORDER: TodaySectionKey[] = ["overdue", "critical_now", "today", "watch"];

export const TODAY_SECTION_TITLE: Record<TodaySectionKey, string> = {
  overdue: "Просрочено",
  critical_now: "Критично сейчас",
  today: "Требует внимания сегодня",
  watch: "Наблюдение",
};

/** One line explaining what earns a place in each section. Shown as section context. */
export const TODAY_SECTION_HINT: Record<TodaySectionKey, string> = {
  overdue: "Срок или SLA уже нарушен — разбирать первыми.",
  critical_now: "Критический приоритет: блокер или приостановленный доступ.",
  today: "Высокий приоритет или срок наступает в ближайшие 24 часа.",
  watch: "Основание есть, срок не горит — посмотреть, когда освободитесь.",
};

/**
 * Number-free wording for each basis. Used in two cases:
 *  - the concrete reason is withheld because it is balance-derived and the role
 *    may not see exact financials (FINANCIALLY_DERIVED_SIGNALS);
 *  - no signal backs the basis, so there is no computed sentence to show.
 * Never contains a figure, so it is safe for every role.
 */
export const TODAY_BASIS_NEUTRAL_TEXT: Record<TodayBasisCode, string> = {
  critical_attention: "Критическое состояние требует разбора.",
  onboarding_attention: "Онбординг не завершён.",
  sla_breached: "SLA нарушен.",
  due_today: "Срок наступает сегодня.",
  mentor_review: "Ожидает решения ментора.",
  support_blockers: "Открыт support-блокер.",
  checkpoint_attention: "Контрольная точка требует проверки.",
  learning_stalled: "Обучение не продвигается.",
  returned_users: "Пользователь вернулся после паузы.",
  new_funded_users: "Недавний первый депозит.",
  repeat_funders: "Повторные пополнения.",
  communication_suppression: "Слишком много коммуникаций.",
  data_quality_issues: "Данные требуют проверки.",
};

/**
 * Bases where a balance actually helps triage, and is therefore projected onto
 * the queue item. Everywhere else the item's financial is `hidden` — a support
 * agent chasing a report does not need a balance to act, so §10 says the number
 * must not be shown merely because a column exists.
 *
 * Must never intersect QUEUES_WITHOUT_FINANCIALS (asserted by a test).
 */
export const TODAY_BASES_WITH_FINANCIALS: ReadonlySet<TodayBasisCode> = new Set([
  "checkpoint_attention",
  "data_quality_issues",
]);
