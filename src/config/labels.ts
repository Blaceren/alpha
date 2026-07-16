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
import type { StateEvidence, StateEvidenceCode } from "@/domain/shared/primitives";
import type { SignalCode, SignalSeverity } from "@/domain/signals/signal";
import type { PriorityBand } from "@/domain/priority/priority";
import type { CheckpointStatus } from "@/domain/financial/financial";
import type { FinancialHiddenReason, FinancialProjectionMode } from "@/domain/financial/projection";
import { HIDDEN_LABEL } from "@/domain/financial/projection";
import {
  RECOMMENDATION_CATALOG,
  type RecommendedActionCode,
  type SuggestedChannel,
} from "@/domain/recommendations/catalog";
import type { TodaySortField } from "@/domain/today/today";

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

/**
 * The single mapping every screen reads to word a recommendation (D-52).
 *
 * DERIVED from the catalog, never authored here. This used to be a hand-kept
 * second copy of the same 18 strings, and it drifted: `remind_email_confirmation`
 * read «Напомнить подтвердить email» on Users/Today and «Напомнить о подтверждении
 * email» on User 360, which reads the catalog. Deriving makes divergence
 * unrepresentable rather than merely tested for.
 *
 * The indirection stays (instead of components reaching into the catalog) so the
 * UI keeps one labelling entry point, exactly like every other map in this file.
 */
export const RECOMMENDATION_LABEL: Record<RecommendedActionCode, string> = Object.fromEntries(
  Object.entries(RECOMMENDATION_CATALOG).map(([code, def]) => [code, def.title]),
) as Record<RecommendedActionCode, string>;

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

/**
 * Today workspace (`/today`) user-facing labels. Same rule as Users and User
 * 360: fully Russian, single source, no raw enum codes on screen.
 */
export const TODAY_LABEL = {
  title: "Сегодня",
  reason: "Причина",
  recommendation: "Рекомендация",
  recommendationNotAllowed: "не для вашей роли",
  owner: "Ответственный",
  due: "Срок",
  lastActivity: "Последняя активность",
  todayEvent: "Сегодня",
  noActivity: "нет активности",
  nothingToday: "сегодня без событий",
  alsoBecause: "Ещё основания",
  openProfile: "Открыть профиль",
  readOnly: "Только просмотр",
  queueScope: "Очередь по вашей роли",
  sort: "Сортировка",
  filters: "Фильтры",
  search: "Поиск по очереди",
  searchPlaceholder: "Имя, email или ID",
  resetFilters: "Сбросить фильтры",
  resetAll: "Сбросить всё",
  /** Summary strip. */
  totalAttention: "Требуют внимания",
  critical: "Критичных",
  slaBreached: "Нарушен SLA",
  unassigned: "Без ответственного",
} as const;

export const TODAY_SORT_LABEL: Record<TodaySortField, string> = {
  urgency: "По срочности",
  last_activity: "Сначала неактивные",
  owner: "По ответственному",
};

/** Filter group labels for the Today toolbar. */
export const TODAY_FILTER_LABEL = {
  priority: "Приоритет",
  basis: "Основание",
  owner: "Ответственный",
  sla: "SLA",
  unassigned: "Без ответственного",
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

/* ------------------------------------------------------- StateEvidence */

/**
 * Russian wording for every `StateEvidenceCode`. Evidence is produced by the
 * domain (signal engine) and read by several features — Today's queue reasons
 * and User 360's attention panel — so the wording lives here once rather than
 * being invented per component. A consistency test asserts this map covers
 * STATE_EVIDENCE_CODES exactly.
 *
 * The label says WHAT was measured. It never carries severity: how bad a value
 * is stays a domain decision (signal severity / priority band), and encoding it
 * in a string would let the two disagree.
 */
export const STATE_EVIDENCE_LABEL: Record<StateEvidenceCode, string> = {
  hours_since_registration: "С момента регистрации",
  pocket_registration_status: "Регистрация Pocket",
  email_confirmed: "Email подтверждён",
  lesson_progress_pct: "Прогресс урока",
  hours_since_last_action: "С последнего значимого действия",
  test_attempts: "Попыток теста",
  latest_test_score: "Последний результат теста",
  report_state: "Состояние отчёта",
  hours_since_report_rejection: "С момента отклонения отчёта",
  sla_elapsed_pct: "Прошло от срока SLA",
  sla_breached: "SLA нарушен",
  checkpoint_delta_pct: "Осталось до контрольной точки",
  grace_confirmations_below_threshold: "Подтверждений ниже порога",
  financial_access_suspended: "Финансовый доступ приостановлен",
  balance_age_minutes: "Возраст данных баланса",
  pocket_data_conflict: "Расхождение данных Pocket",
  days_inactive: "Дней без активности",
  engagement_status: "Активность",
  communications_24h: "Сообщений за 24ч",
  communications_7d: "Сообщений за 7д",
  support_state: "Состояние поддержки",
  redeposit_count: "Повторных депозитов",
  balance_drop_pct: "Падение баланса",
};

/**
 * How to render each code's raw `value`. Kept beside the labels because the two
 * must agree: "Прошло от срока SLA" is meaningless without the `%`.
 * Enum-valued units delegate to the label maps above so one status is never
 * worded two ways.
 */
type EvidenceUnit =
  | "hours"
  | "days"
  | "minutes"
  | "percent"
  | "count"
  | "plain"
  | "flag"
  | "registration_status"
  | "report_state"
  | "support_state"
  | "engagement_status";

const STATE_EVIDENCE_UNIT: Record<StateEvidenceCode, EvidenceUnit> = {
  hours_since_registration: "hours",
  pocket_registration_status: "registration_status",
  email_confirmed: "flag",
  lesson_progress_pct: "percent",
  hours_since_last_action: "hours",
  test_attempts: "count",
  latest_test_score: "plain",
  report_state: "report_state",
  hours_since_report_rejection: "hours",
  sla_elapsed_pct: "percent",
  sla_breached: "flag",
  checkpoint_delta_pct: "percent",
  grace_confirmations_below_threshold: "count",
  financial_access_suspended: "flag",
  balance_age_minutes: "minutes",
  pocket_data_conflict: "flag",
  days_inactive: "days",
  engagement_status: "engagement_status",
  communications_24h: "count",
  communications_7d: "count",
  support_state: "support_state",
  redeposit_count: "count",
  balance_drop_pct: "percent",
};

/**
 * Wording for an evidence code the map does not know. Deliberately neutral
 * rather than `humanizeCode(code)`: humanizing prints the raw snake_case back
 * in English ("support_blocked" → "Support blocked"), which is exactly what the
 * UI must never show. The consistency test means this can only be reached by a
 * code added without a label — losing detail is the correct failure here.
 */
const UNKNOWN_EVIDENCE_LABEL = "Системный признак";
const UNKNOWN_EVIDENCE_VALUE = "—";

/** Russian label for an evidence code; safe for codes outside the enum. */
export function evidenceLabel(code: string): string {
  return STATE_EVIDENCE_LABEL[code as StateEvidenceCode] ?? UNKNOWN_EVIDENCE_LABEL;
}

/** Render an evidence value in Russian, with its unit. Never emits a raw enum. */
export function evidenceValue(evidence: StateEvidence): string {
  const { value } = evidence;
  const unit = STATE_EVIDENCE_UNIT[evidence.code];
  if (unit === undefined) return UNKNOWN_EVIDENCE_VALUE;
  // A missing measurement is a fact worth stating, not a blank.
  if (value === null) return "Нет данных";

  switch (unit) {
    case "hours":
      return `${value} ч`;
    case "days":
      return `${value} д`;
    case "minutes":
      // Minutes are the measurement's unit, not a readable one at every scale:
      // a balance untouched for two weeks is "20160 мин", and eight hours is
      // "500 мин". Step up to the unit an operator would actually say.
      if (typeof value !== "number") return `${value} мин`;
      if (value >= 1440) return `${Math.round(value / 1440)} д`;
      if (value >= 120) return `${Math.round(value / 60)} ч`;
      return `${value} мин`;
    case "percent":
      return `${value}%`;
    case "flag":
      return value ? "Да" : "Нет";
    case "registration_status":
      return REGISTRATION_STATUS_LABEL[value as RegistrationStatus] ?? UNKNOWN_EVIDENCE_VALUE;
    case "report_state":
      return REPORT_STATE_LABEL[value as keyof typeof REPORT_STATE_LABEL] ?? UNKNOWN_EVIDENCE_VALUE;
    case "support_state":
      return SUPPORT_STATE_LABEL[value as keyof typeof SUPPORT_STATE_LABEL] ?? UNKNOWN_EVIDENCE_VALUE;
    case "engagement_status":
      return ENGAGEMENT_LABEL[value as EngagementStatus] ?? UNKNOWN_EVIDENCE_VALUE;
    case "count":
    case "plain":
    default:
      return String(value);
  }
}

/** One evidence item ready to render: "Осталось до контрольной точки · 10%". */
export function formatEvidence(evidence: StateEvidence): { label: string; value: string } {
  return { label: evidenceLabel(evidence.code), value: evidenceValue(evidence) };
}
