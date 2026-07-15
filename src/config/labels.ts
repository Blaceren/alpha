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
import type { SignalCode } from "@/domain/signals/signal";
import type { PriorityBand } from "@/domain/priority/priority";
import type { CheckpointStatus } from "@/domain/financial/financial";
import type { RecommendedActionCode } from "@/domain/recommendations/catalog";

export type RegistrationStatus = "not_registered" | "registration_pending" | "registered";

export const REGISTRATION_STATUS_LABEL: Record<RegistrationStatus, string> = {
  not_registered: "Не зарегистрирован",
  registration_pending: "Регистрация проверяется",
  registered: "Регистрация подтверждена",
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
  review_checkpoint_grace: "Разобрать checkpoint grace",
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
