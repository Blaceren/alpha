/**
 * Explainable recommended-action catalog (Phase 1B1 §7).
 * Every recommendation is derived from signals and carries its rationale.
 *
 * SAFETY: no financial-pressure actions exist here. After a balance decline only
 * educational / mentor / support / communication-suppression actions are allowed.
 */
import type { CrmRole } from "@/domain/identity/roles";
import type { SignalCode } from "@/domain/signals/signal";

/** Priority band for a recommendation (kept independent of task PriorityLevel). */
export type ActionPriority = "critical" | "high" | "normal" | "low";

export type RecommendedActionCode =
  | "review_new_registration"
  | "help_complete_pocket_registration"
  | "remind_email_confirmation"
  | "continue_current_lesson"
  | "offer_learning_recap"
  | "review_failed_test"
  | "review_report"
  | "request_report_revision"
  | "mentor_follow_up"
  | "support_follow_up"
  | "verify_financial_data"
  | "review_checkpoint_grace"
  | "restore_learning_path"
  | "reduce_communication_frequency"
  | "review_risk_material"
  | "open_pause_protocol"
  | "celebrate_learning_return"
  | "no_action_required";

/**
 * Action codes that are explicitly PROHIBITED anywhere in the system.
 * Kept as a runtime constant so a test can assert none leak into the catalog.
 */
export const PROHIBITED_ACTION_CODES = [
  "deposit_now",
  "recover_losses",
  "increase_trade_size",
  "trade_more",
  "restore_balance_by_deposit",
  "urgent_redeposit",
] as const;

export type SuggestedChannel = "in_app" | "email" | "mentor" | "support" | "none";

export interface RecommendedActionDef {
  code: RecommendedActionCode;
  /**
   * THE canonical user-facing Russian wording for this code (D-52). Authored
   * here and nowhere else: `config/labels`.RECOMMENDATION_LABEL is derived from
   * it, so every screen — and every future audit record naming the action —
   * resolves to this exact string.
   *
   * A second hand-written map of these 18 strings used to exist; three of them
   * drifted, and the same action read one way on User 360 and another on
   * Users/Today. Add a code here and both sides move together.
   */
  title: string;
  reason: string;
  sourceSignalCodes: SignalCode[];
  allowedRoles: CrmRole[];
  priority: ActionPriority;
  suggestedChannel: SuggestedChannel;
  cooldownHours: number;
  /** Human-readable conditions under which this action must NOT be taken. */
  prohibitedWhen: string[];
  humanApprovalRequired: boolean;
}

const RETENTION: CrmRole[] = ["crm_admin", "crm_manager", "retention_manager"];
const RETENTION_MENTOR: CrmRole[] = [...RETENTION, "mentor"];
const RETENTION_SUPPORT: CrmRole[] = [...RETENTION, "support"];

export const RECOMMENDATION_CATALOG: Record<RecommendedActionCode, RecommendedActionDef> = {
  review_new_registration: {
    code: "review_new_registration",
    title: "Разобрать нового пользователя",
    reason: "Пользователь зарегистрировался, но не начал обучение.",
    sourceSignalCodes: ["registration_no_start"],
    allowedRoles: RETENTION,
    priority: "normal",
    suggestedChannel: "in_app",
    cooldownHours: 24,
    prohibitedWhen: [],
    humanApprovalRequired: false,
  },
  help_complete_pocket_registration: {
    code: "help_complete_pocket_registration",
    title: "Помочь завершить регистрацию Pocket",
    reason: "Регистрация Pocket не завершена — обучение и финансовые контрольные точки заблокированы.",
    sourceSignalCodes: ["pocket_registration_incomplete"],
    allowedRoles: RETENTION_SUPPORT,
    priority: "high",
    suggestedChannel: "in_app",
    cooldownHours: 24,
    prohibitedWhen: ["communication_fatigue active"],
    humanApprovalRequired: false,
  },
  remind_email_confirmation: {
    code: "remind_email_confirmation",
    title: "Напомнить о подтверждении email",
    reason: "Email не подтверждён.",
    sourceSignalCodes: ["email_not_confirmed"],
    allowedRoles: RETENTION,
    priority: "normal",
    suggestedChannel: "email",
    cooldownHours: 24,
    prohibitedWhen: ["communication_fatigue active"],
    humanApprovalRequired: false,
  },
  continue_current_lesson: {
    code: "continue_current_lesson",
    title: "Подтолкнуть продолжить урок",
    reason: "Урок начат, но не завершён.",
    sourceSignalCodes: ["lesson_abandoned"],
    allowedRoles: RETENTION,
    priority: "normal",
    suggestedChannel: "in_app",
    cooldownHours: 24,
    prohibitedWhen: ["communication_fatigue active"],
    humanApprovalRequired: false,
  },
  offer_learning_recap: {
    code: "offer_learning_recap",
    title: "Предложить учебный recap",
    reason: "Прогресс остановился — освежить материал.",
    sourceSignalCodes: ["progression_stalled", "inactive_3_days", "inactive_7_days"],
    allowedRoles: RETENTION,
    priority: "normal",
    suggestedChannel: "in_app",
    cooldownHours: 48,
    prohibitedWhen: ["communication_fatigue active"],
    humanApprovalRequired: false,
  },
  review_failed_test: {
    code: "review_failed_test",
    title: "Разобрать проваленный тест",
    reason: "Несколько неудачных попыток теста подряд.",
    sourceSignalCodes: ["repeated_test_failure"],
    allowedRoles: RETENTION_MENTOR,
    priority: "normal",
    suggestedChannel: "mentor",
    cooldownHours: 24,
    prohibitedWhen: [],
    humanApprovalRequired: false,
  },
  review_report: {
    code: "review_report",
    title: "Проверить отчёт",
    reason: "Отчёт ожидает mentor-проверки.",
    sourceSignalCodes: ["report_pending", "mentor_sla_risk"],
    allowedRoles: ["crm_admin", "crm_manager", "mentor"],
    priority: "high",
    suggestedChannel: "mentor",
    cooldownHours: 6,
    prohibitedWhen: [],
    humanApprovalRequired: false,
  },
  request_report_revision: {
    code: "request_report_revision",
    title: "Запросить доработку отчёта",
    reason: "Отчёт отклонён и не отправлен повторно.",
    sourceSignalCodes: ["report_rejected_no_return"],
    allowedRoles: ["crm_admin", "crm_manager", "mentor"],
    priority: "high",
    suggestedChannel: "mentor",
    cooldownHours: 24,
    prohibitedWhen: [],
    humanApprovalRequired: false,
  },
  mentor_follow_up: {
    code: "mentor_follow_up",
    title: "Follow-up ментора",
    reason: "Пользователь заблокирован на mentor-этапе.",
    sourceSignalCodes: ["mentor_sla_risk", "report_rejected_no_return"],
    allowedRoles: ["crm_admin", "crm_manager", "mentor"],
    priority: "high",
    suggestedChannel: "mentor",
    cooldownHours: 12,
    prohibitedWhen: [],
    humanApprovalRequired: false,
  },
  support_follow_up: {
    code: "support_follow_up",
    title: "Follow-up поддержки",
    reason: "Открыт support-блокер.",
    sourceSignalCodes: ["support_blocked"],
    allowedRoles: ["crm_admin", "crm_manager", "support"],
    priority: "critical",
    suggestedChannel: "support",
    cooldownHours: 4,
    prohibitedWhen: [],
    humanApprovalRequired: false,
  },
  verify_financial_data: {
    code: "verify_financial_data",
    title: "Проверить финансовые данные",
    reason: "Расхождение данных баланса продукт↔Pocket.",
    sourceSignalCodes: ["pocket_data_conflict", "balance_data_stale"],
    allowedRoles: RETENTION,
    priority: "high",
    suggestedChannel: "none",
    cooldownHours: 4,
    prohibitedWhen: [],
    humanApprovalRequired: true,
  },
  review_checkpoint_grace: {
    code: "review_checkpoint_grace",
    // Triggered by BOTH checkpoint_approaching and checkpoint_grace_active, so
    // the wording must not claim a grace period that may not exist.
    title: "Разобрать контрольную точку",
    reason: "Финансовая контрольная точка требует внимания: приближение или активный grace-период.",
    sourceSignalCodes: ["checkpoint_grace_active", "checkpoint_approaching"],
    allowedRoles: RETENTION,
    priority: "high",
    suggestedChannel: "none",
    cooldownHours: 6,
    prohibitedWhen: ["open trades present (decision deferred)"],
    humanApprovalRequired: true,
  },
  restore_learning_path: {
    code: "restore_learning_path",
    title: "Восстановить учебный доступ",
    reason: "Финансовый доступ приостановлен — сопроводить восстановление обучения.",
    sourceSignalCodes: ["financial_access_suspended"],
    allowedRoles: RETENTION,
    priority: "high",
    suggestedChannel: "in_app",
    cooldownHours: 12,
    prohibitedWhen: ["never suggest depositing to restore access"],
    humanApprovalRequired: true,
  },
  reduce_communication_frequency: {
    code: "reduce_communication_frequency",
    title: "Снизить частоту коммуникаций",
    reason: "Признаки communication fatigue.",
    sourceSignalCodes: ["communication_fatigue"],
    allowedRoles: RETENTION,
    priority: "normal",
    suggestedChannel: "none",
    cooldownHours: 24,
    prohibitedWhen: [],
    humanApprovalRequired: false,
  },
  review_risk_material: {
    code: "review_risk_material",
    title: "Предложить материал по управлению риском",
    reason: "Резкое падение баланса — образовательный, не финансовый ответ.",
    sourceSignalCodes: ["rapid_balance_decline"],
    allowedRoles: RETENTION_MENTOR,
    priority: "high",
    suggestedChannel: "in_app",
    cooldownHours: 24,
    prohibitedWhen: ["never suggest depositing or increasing trade size"],
    humanApprovalRequired: true,
  },
  open_pause_protocol: {
    code: "open_pause_protocol",
    title: "Открыть протокол паузы",
    reason: "Частые redeposit — предложить осознанную паузу и поддержку.",
    sourceSignalCodes: ["frequent_redeposit_pattern", "rapid_balance_decline"],
    allowedRoles: RETENTION,
    priority: "normal",
    suggestedChannel: "support",
    cooldownHours: 48,
    prohibitedWhen: ["never encourage more deposits or trading"],
    humanApprovalRequired: true,
  },
  celebrate_learning_return: {
    code: "celebrate_learning_return",
    title: "Отметить возвращение к обучению",
    reason: "Пользователь вернулся после длительного отсутствия.",
    sourceSignalCodes: ["returned_after_absence"],
    allowedRoles: RETENTION,
    priority: "normal",
    suggestedChannel: "in_app",
    cooldownHours: 24,
    prohibitedWhen: ["communication_fatigue active"],
    humanApprovalRequired: false,
  },
  no_action_required: {
    code: "no_action_required",
    title: "Действие не требуется",
    reason: "Активных сигналов, требующих вмешательства, нет.",
    sourceSignalCodes: [],
    allowedRoles: [
      "crm_admin",
      "crm_manager",
      "retention_manager",
      "mentor",
      "support",
      "moderator",
      "analyst",
      "content_manager",
      "read_only",
    ],
    priority: "low",
    suggestedChannel: "none",
    cooldownHours: 0,
    prohibitedWhen: [],
    humanApprovalRequired: false,
  },
};

/** Signal → recommended action codes. Single source used by the signal engine. */
export const SIGNAL_TO_ACTIONS: Record<SignalCode, RecommendedActionCode[]> = {
  registration_no_start: ["review_new_registration"],
  pocket_registration_incomplete: ["help_complete_pocket_registration"],
  email_not_confirmed: ["remind_email_confirmation"],
  lesson_abandoned: ["continue_current_lesson"],
  progression_stalled: ["offer_learning_recap", "restore_learning_path"],
  repeated_test_failure: ["review_failed_test"],
  report_pending: ["review_report"],
  report_rejected_no_return: ["request_report_revision", "mentor_follow_up"],
  mentor_sla_risk: ["review_report", "mentor_follow_up"],
  checkpoint_approaching: ["review_checkpoint_grace"],
  checkpoint_grace_active: ["review_checkpoint_grace"],
  financial_access_suspended: ["restore_learning_path"],
  balance_data_stale: ["verify_financial_data"],
  pocket_data_conflict: ["verify_financial_data"],
  inactive_3_days: ["offer_learning_recap"],
  inactive_7_days: ["offer_learning_recap"],
  dormant_14_days: ["offer_learning_recap"],
  dormant_30_days: ["offer_learning_recap"],
  returned_after_absence: ["celebrate_learning_return"],
  communication_fatigue: ["reduce_communication_frequency"],
  support_blocked: ["support_follow_up"],
  frequent_redeposit_pattern: ["open_pause_protocol"],
  rapid_balance_decline: ["review_risk_material", "open_pause_protocol"],
};
