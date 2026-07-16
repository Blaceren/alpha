/**
 * Centralized human labels for enum codes (Phase 1B1 §16). The UI must render
 * these, never raw codes like `at_risk` or `checkpoint_grace`. Single source —
 * do not hardcode label strings inside pages/components.
 */
import type {
  EngagementStatus,
  FundingStatus,
  LifecycleStage,
  OperationalBlocker,
  ValueSegment,
} from "@/domain/lifecycle/state";
import type { SignalCode, SignalSeverity } from "@/domain/signals/signal";
import type { PriorityBand } from "@/domain/priority/priority";
import type { CheckpointStatus } from "@/domain/financial/financial";
import type { FinancialHiddenReason, FinancialProjectionMode } from "@/domain/financial/projection";
import { HIDDEN_LABEL } from "@/domain/financial/projection";
import type { RecommendedActionCode, SuggestedChannel } from "@/domain/recommendations/catalog";

export type RegistrationStatus = "not_registered" | "registration_pending" | "registered";

export const REGISTRATION_STATUS_LABEL: Record<RegistrationStatus, string> = {
  not_registered: "Не зарегистрирован",
  registration_pending: "Регистрация проверяется",
  registered: "Регистрация подтверждена",
};

/**
 * Human text for a hidden financial value, shared by every renderer of
 * `FinancialProjection` (Users table cell, User 360 summary) so "no data" can
 * never be shown as "no permission" in one place and not the other. Keyed by the
 * projection's own `hiddenReason` — the UI never guesses.
 *
 * Re-exported from the projection itself, which uses the same strings for its
 * `label`: one source, so read model and screen cannot contradict each other.
 */
export const FINANCIAL_HIDDEN_LABEL = HIDDEN_LABEL;

/** Tooltip for each hidden reason. Must never contain the withheld value. */
export const FINANCIAL_HIDDEN_TOOLTIP: Record<FinancialHiddenReason, string> = {
  no_data: "Значение ещё не поступало из продукта",
  not_permitted: "Финансовые данные недоступны для вашей роли",
};

/** Suffix marking a non-exact financial representation. */
export const FINANCIAL_MODE_SUFFIX: Partial<Record<FinancialProjectionMode, string>> = {
  bucket: "диапазон",
  aggregated: "агрег.",
};

export const CHECKPOINT_LABEL: Record<CheckpointStatus, string> = {
  not_reached: "Checkpoint не достигнут",
  approaching: "Приближается checkpoint",
  met: "Checkpoint пройден",
  grace: "Grace-период",
  suspended: "Доступ приостановлен",
  restored: "Доступ восстановлен",
  future_checkpoint_not_defined: "Программа в разработке",
};

/** Human labels for priority reason codes (computePriority reasonCode). */
export const PRIORITY_REASON_LABEL: Record<string, string> = {
  critical_support_issue: "Критический support-блокер",
  financial_access_suspended: "Финансовый доступ приостановлен",
  financial_data_conflict: "Конфликт финансовых данных",
  sla_breach: "Нарушен SLA",
  checkpoint_grace_near_expiration: "Grace-период скоро истечёт",
  report_or_mentor_blocker: "Блокер отчёта/ментора",
  rapid_balance_decline: "Резкое падение баланса",
  returned_user: "Вернувшийся пользователь",
  progression_stalled: "Прогресс остановился",
  ordinary_follow_up: "Плановый follow-up",
  no_priority_signal: "Без активных сигналов",
};

export const RECOMMENDATION_LABEL: Record<RecommendedActionCode, string> = {
  review_new_registration: "Разобрать нового пользователя",
  help_complete_pocket_registration: "Помочь завершить регистрацию Pocket",
  remind_email_confirmation: "Напомнить подтвердить email",
  continue_current_lesson: "Подтолкнуть продолжить урок",
  offer_learning_recap: "Предложить учебный recap",
  review_failed_test: "Разобрать проваленный тест",
  review_report: "Проверить отчёт",
  request_report_revision: "Запросить доработку отчёта",
  mentor_follow_up: "Follow-up ментора",
  support_follow_up: "Follow-up поддержки",
  verify_financial_data: "Проверить финансовые данные",
  review_checkpoint_grace: "Разобрать контрольную точку",
  restore_learning_path: "Восстановить учебный доступ",
  reduce_communication_frequency: "Снизить частоту коммуникаций",
  review_risk_material: "Материал по управлению риском",
  open_pause_protocol: "Открыть протокол паузы",
  celebrate_learning_return: "Отметить возвращение",
  no_action_required: "Действие не требуется",
};

export const LIFECYCLE_LABEL: Record<LifecycleStage, string> = {
  registered: "Зарегистрирован",
  pocket_registered: "Pocket зарегистрирован",
  pre_ftd: "До первого депозита",
  first_depositor: "Первый депозит",
  active: "Активен",
  at_risk: "В зоне риска",
  dormant: "Спящий",
  reactivated: "Реактивирован",
  completed_current_curriculum: "Программа пройдена",
};

export const FUNDING_LABEL: Record<FundingStatus, string> = {
  not_available: "Недоступно",
  unfunded: "Без депозита",
  funded: "Фондирован",
  checkpoint_grace: "Grace-период",
  financial_access_suspended: "Доступ приостановлен",
  balance_unknown: "Баланс неизвестен",
};

export const ENGAGEMENT_LABEL: Record<EngagementStatus, string> = {
  not_started: "Не начал",
  active: "Активен",
  progression_stalled: "Прогресс стоит",
  inactive_3d: "Неактивен 3д",
  inactive_7d: "Неактивен 7д",
  dormant_14d: "Спящий 14д",
  dormant_30d: "Спящий 30д",
  returned: "Вернулся",
};

export const VALUE_SEGMENT_LABEL: Record<ValueSegment, string> = {
  first_depositor: "Первый депозит",
  repeat_funder: "Повторный funder",
  frequent_repeat_funder: "Частый funder",
  high_value_candidate: "High-value кандидат",
  advanced_learner: "Продвинутый ученик",
};

export const BLOCKER_LABEL: Record<OperationalBlocker, string> = {
  email_unconfirmed: "Email не подтверждён",
  pocket_registration_incomplete: "Регистрация Pocket не завершена",
  report_pending: "Отчёт на проверке",
  mentor_blocked: "Заблокирован ментором",
  support_blocked: "Заблокирован поддержкой",
  financial_data_conflict: "Конфликт фин. данных",
  communication_fatigue: "Перегрузка коммуникациями",
};

export const PRIORITY_LABEL: Record<PriorityBand, string> = {
  critical: "Критический",
  high: "Высокий",
  normal: "Обычный",
  low: "Низкий",
};

export const SIGNAL_LABEL: Record<SignalCode, string> = {
  registration_no_start: "Регистрация без старта",
  pocket_registration_incomplete: "Регистрация Pocket не завершена",
  email_not_confirmed: "Email не подтверждён",
  lesson_abandoned: "Урок брошен",
  progression_stalled: "Прогресс остановился",
  repeated_test_failure: "Повторные провалы теста",
  report_pending: "Отчёт на проверке",
  report_rejected_no_return: "Отчёт отклонён без возврата",
  mentor_sla_risk: "Риск SLA ментора",
  checkpoint_approaching: "Приближается checkpoint",
  checkpoint_grace_active: "Активен grace-период",
  financial_access_suspended: "Доступ приостановлен",
  balance_data_stale: "Баланс устарел",
  pocket_data_conflict: "Конфликт данных Pocket",
  inactive_3_days: "Неактивен 3 дня",
  inactive_7_days: "Неактивен 7 дней",
  dormant_14_days: "Спящий 14 дней",
  dormant_30_days: "Спящий 30 дней",
  returned_after_absence: "Вернулся после паузы",
  communication_fatigue: "Перегрузка коммуникациями",
  support_blocked: "Заблокирован поддержкой",
  frequent_redeposit_pattern: "Частые повторные депозиты",
  rapid_balance_decline: "Резкое падение баланса",
};

/**
 * User-facing column / control labels for the Users workspace. Single source —
 * components must not hardcode these strings. Terminology is fully Russian
 * (no `Lifecycle`/`Engagement`/`Owner` in the UI); TS enum names are unchanged.
 */
export const USERS_COLUMN_LABEL = {
  user: "Пользователь",
  priority: "Приоритет",
  lifecycle: "Этап",
  funding: "Финансовый статус",
  engagement: "Активность",
  states: "Состояния",
  progress: "Прогресс",
  blockers: "Активные блокеры",
  owner: "Ответственный",
  lastActivity: "Последняя активность",
  valueSegments: "Ценностные сегменты",
  recommendation: "Рекомендация",
  registrationStatus: "Регистрация Pocket",
  campaign: "Кампания / источник",
  balance: "Баланс",
  netDeposits: "Чистые депозиты",
} as const;

/**
 * User 360 (`/users/[id]`) user-facing labels. Same rule as the Users workspace:
 * fully Russian terminology, single source, no raw enum codes in the UI.
 * Domain terms (`Pocket`, `XP`, `Grace-период`, `SLA`) are kept intentionally.
 */
export const USER_360_LABEL = {
  backToUsers: "Пользователи",
  attention: "Почему требует внимания",
  noAttention: "Активных причин для внимания нет",
  recommendation: "Рекомендуемое действие",
  recommendationBasis: "Основание",
  states: "Состояния",
  learning: "Обучение",
  blockers: "Активные блокеры",
  signals: "Системные сигналы",
  activity: "Недавние события",
  financial: "Финансы",
  ownerContext: "Ответственный и работа",
  identity: "Идентификация",
  priorityBasis: "Основание приоритета",
  readOnly: "Только просмотр",
  userId: "ID пользователя",
} as const;

export const SIGNAL_SEVERITY_LABEL: Record<SignalSeverity, string> = {
  critical: "Критическая",
  high: "Высокая",
  medium: "Средняя",
  low: "Низкая",
};

/** Suggested channel of a recommended action (who/how it would be delivered). */
export const CHANNEL_LABEL: Record<SuggestedChannel, string> = {
  in_app: "В приложении",
  email: "Email",
  mentor: "Ментор",
  support: "Поддержка",
  none: "Без коммуникации",
};

export const REPORT_STATE_LABEL: Record<"none" | "pending" | "approved" | "rejected", string> = {
  none: "Нет отчёта",
  pending: "На проверке",
  approved: "Принят",
  rejected: "Отклонён",
};

export const MENTOR_REVIEW_LABEL: Record<
  "none" | "queued" | "in_review" | "approved" | "rejected",
  string
> = {
  none: "Нет проверки",
  queued: "В очереди",
  in_review: "На проверке",
  approved: "Принято",
  rejected: "Отклонено",
};

export const SUPPORT_STATE_LABEL: Record<"none" | "open" | "blocked" | "resolved", string> = {
  none: "Нет обращений",
  open: "Открыто обращение",
  blocked: "Заблокирован",
  resolved: "Решено",
};

export const MENTOR_STATE_LABEL: Record<"none" | "queued" | "reviewing" | "blocked", string> = {
  none: "Нет проверки",
  queued: "В очереди",
  reviewing: "На проверке",
  blocked: "Заблокирован",
};

/** SLA keys present in the mock dataset (docs/SLA_POLICY.md). */
export const SLA_KEY_LABEL: Record<string, string> = {
  mentor_review: "Проверка ментора",
  support_high: "Поддержка (высокий)",
  support_critical: "Поддержка (критический)",
  support_normal: "Поддержка (обычный)",
  retention_follow_up: "Retention follow-up",
  financial_data_conflict: "Конфликт финансовых данных",
};

export const SLA_STATE_LABEL: Record<"on_track" | "warning" | "breached" | "none", string> = {
  on_track: "В срок",
  warning: "Под риском",
  breached: "Нарушен",
  none: "Без SLA",
};

/** Where a timeline event came from (User 360 activity). */
export const ACTIVITY_SOURCE_LABEL: Record<"product" | "pocket" | "employee", string> = {
  product: "Продукт",
  pocket: "Pocket",
  employee: "Сотрудник",
};

/** Human labels for mock employee (owner) ids. */
export const OWNER_LABEL: Record<string, string> = {
  emp_admin: "Администратор",
  emp_mgr: "Менеджер",
  emp_ret1: "Retention 1",
  emp_ret2: "Retention 2",
  emp_men1: "Mentor 1",
  emp_sup1: "Support 1",
  emp_mod1: "Moderator 1",
  emp_an1: "Analyst 1",
  emp_mock_admin: "Demo Operator",
};

export function ownerLabel(ownerId: string | null | undefined): string {
  if (!ownerId) return "Не назначен";
  return OWNER_LABEL[ownerId] ?? humanizeCode(ownerId);
}

/** Generic fallback: humanize an unknown code (never show raw snake_case). */
export function humanizeCode(code: string): string {
  return code.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
