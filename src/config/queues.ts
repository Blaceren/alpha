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
