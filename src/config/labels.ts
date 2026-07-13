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

export const LIFECYCLE_LABEL: Record<LifecycleStage, string> = {
  registered: "Зарегистрирован",
  pocket_connected: "Pocket подключён",
  pre_ftd: "До первого депозита",
  first_depositor: "Первый депозит",
  active: "Активен",
  at_risk: "В зоне риска",
  dormant: "Спящий",
  reactivated: "Реактивирован",
  completed_current_curriculum: "Программа пройдена",
};

export const FUNDING_LABEL: Record<FundingStatus, string> = {
  not_connected: "Не подключён",
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
  pocket_not_connected: "Pocket не подключён",
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
  pocket_not_connected: "Pocket не подключён",
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

/** Generic fallback: humanize an unknown code (never show raw snake_case). */
export function humanizeCode(code: string): string {
  return code.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
