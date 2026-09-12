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
import { EMPLOYEE_DIRECTORY } from "@/domain/identity/employees";
import type { AuditRecordView } from "@/domain/audit/audit-view";
import type { NoteVisibility } from "@/domain/notes/note";
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
  notes: "Заметки",
} as const;

/**
 * Owner assignment inside the "Ответственный и работа" section (Phase 1B4-C).
 *
 * Same rule as the notes section: one source for the strings, and none of them
 * carries an employee id, an audit id or a diagnostic. `success` is deliberately
 * the same sentence whether an owner was set, replaced or cleared — the employee
 * asked for one thing ("this is who owns them now") and got it; three variants
 * would describe our bookkeeping instead of their action.
 */
export const OWNER_ASSIGN_LABEL = {
  fieldLabel: "Ответственный",
  unassignedOption: "Без ответственного",
  submit: "Сохранить",
  submitPending: "Сохраняем…",
  success: "Ответственный обновлён",
  loadingCandidates: "Загрузка списка сотрудников",
  /** Shown instead of a form — never as a disabled control (DECISIONS D-59). */
  forbidden: "Ваша роль не может менять ответственного",
  /** Someone else won the race; the screen now shows what is actually stored. */
  conflict: "Ответственный уже изменён. Показаны актуальные данные.",
} as const;

/**
 * Notes section of the User 360 (Phase 1B4-B) — the first mutating surface in
 * the CRM. Same rule as everywhere else: one source for the strings, no raw
 * codes and no provider diagnostics on screen.
 */
export const NOTES_LABEL = {
  title: USER_360_LABEL.notes,
  /** Says what this role has to show, not that no note exists anywhere. */
  empty: "Заметок пока нет",
  loading: "Загрузка заметок",
  loadError: "Не удалось загрузить заметки",
  retry: "Повторить",
  composerLabel: "Текст заметки",
  composerPlaceholder: "Что важно знать о работе с этим пользователем",
  submit: "Добавить заметку",
  /** Mobile disclosure, open state — distinct from the submit control's name. */
  collapse: "Свернуть",
  submitPending: "Сохраняем…",
  success: "Заметка добавлена",
  /** Shown instead of a form — never as a disabled control (DECISIONS D-59). */
  forbidden: "Ваша роль не может добавлять заметки",
} as const;

/**
 * Note pin/unpin (Phase 1B4-D). The action labels are the controls' FULL
 * accessible names — the button may render only a pin glyph, but a screen reader
 * must hear the whole instruction, so these are used as `aria-label`, not just as
 * a tooltip. Same single-source, no-raw-code, no-diagnostics rule as the rest.
 */
export const NOTE_PIN_LABEL = {
  /** Accessible name when the note is NOT pinned — the action pins it. */
  pinAction: "Закрепить заметку",
  /** Accessible name when the note IS pinned — the action unpins it. */
  unpinAction: "Открепить заметку",
  /** Announced through the control while its own write is in flight. */
  pending: "Сохраняем…",
  /** Calm marker on a pinned note — never a hero accent, toast, red or glow. */
  pinnedBadge: "Закреплено",
  successPinned: "Заметка закреплена",
  successUnpinned: "Заметка откреплена",
  /** Someone else changed the pin first; the list now shows what is stored. */
  conflict: "Состояние заметки уже изменилось. Показаны актуальные данные.",
} as const;

/**
 * Note body editing (Phase 1B4-E). Same single-source, no-raw-code, no-diagnostics
 * rule as the rest. The control labels are full instructions so a screen reader
 * hears the whole action, not a glyph. No label here interpolates a note id, body
 * or any bookkeeping.
 */
export const NOTE_EDIT_LABEL = {
  /** Opens the inline editor for a note the actor authored. */
  editAction: "Изменить заметку",
  /** Textarea label inside the editor — distinct from the composer's «Текст заметки». */
  editLabel: "Новый текст заметки",
  save: "Сохранить",
  cancel: "Отменить",
  /** Announced through the Save control while its own write is in flight. */
  pending: "Сохраняем…",
  success: "Заметка обновлена",
  /** Someone else edited first; the list now shows what is actually stored. */
  conflict: "Заметка уже изменена. Показан актуальный текст.",
} as const;

/**
 * Global Audit Workspace (`/audit`, Phase 1B5-B). Same single-source, no-raw-code,
 * no-diagnostics rule as the rest. Nothing here interpolates a raw id, a note body
 * or any bookkeeping — the action sentences take already-resolved names, and the
 * pin direction is rendered as WORDS (закрепил/открепил), never a colour.
 *
 * The header copy is deliberately honest about what this log is: a browser-local
 * demo journal, NOT an immutable system/compliance record. Every string that
 * describes it says so.
 */
export const AUDIT_LABEL = {
  title: "Audit",
  subtitle: "Последние действия, сохранённые в этом браузере.",
  /** Calm demo caption — pairs with the top-level DEMO MODE badge, never repeats it. */
  demoNote: "Локальный demo-журнал. Серверная история пока не подключена.",
  loading: "Загрузка журнала",
  /** Section heading over the ledger; the count sits beside it. */
  ledgerHeading: "Журнал действий",
  totalLabel: "Всего записей",
  emptyTitle: "Действий ещё не было",
  emptyText:
    "Изменения заметок и ответственного, выполненные в этом браузере, появятся здесь.",
  restrictedTitle: "Глобальный журнал недоступен",
  restrictedText: "Ваша роль не может просматривать глобальный журнал действий.",
  errorTitle: "Не удалось загрузить журнал",
  retry: "Повторить",
  /** Owner before→after connector, e.g. «Не назначен → Менеджер». */
  ownerTransitionLabel: "Ответственный",
} as const;

/** One rendered audit row: the primary sentence and an optional detail line. */
export interface AuditRowText {
  /** Human-readable sentence. Already contains the resolved actor and target. */
  primary: string;
  /** Owner before→after (owner changes only), else null. */
  detail: string | null;
}

/**
 * The single source of an audit row's human text (Phase 1B5-B). Takes the safe,
 * already-resolved `AuditRecordView` — it never sees a raw id, a note body or a
 * reason code — and returns the exact copy the contract specifies (§5). The pin
 * direction is rendered as WORDS (закрепил/открепил), so it never depends on
 * colour, and the body-change sentence never reveals any text.
 */
export function auditRowText(view: AuditRecordView): AuditRowText {
  switch (view.action) {
    case "note_added":
      return {
        primary: `${view.actorName} добавил заметку для ${view.targetUserName}`,
        detail: null,
      };
    case "primary_owner_changed":
      return {
        primary: `${view.actorName} изменил ответственного у ${view.targetUserName}`,
        detail: `${view.previousOwnerName} → ${view.nextOwnerName}`,
      };
    case "note_pin_changed":
      return {
        primary: view.pinned
          ? `${view.actorName} закрепил заметку у ${view.targetUserName}`
          : `${view.actorName} открепил заметку у ${view.targetUserName}`,
        detail: null,
      };
    case "note_body_changed":
      return {
        primary: `${view.actorName} изменил текст заметки у ${view.targetUserName}`,
        detail: null,
      };
    case "note_visibility_changed":
      // Fact only — never the direction (team/private), so the global log cannot
      // disclose that a note is now hidden (D-91).
      return {
        primary: `${view.actorName} изменил доступ к заметке у ${view.targetUserName}`,
        detail: null,
      };
    case "note_deleted":
      // Neutral fact only (Phase 1B6) — never the deleted body, its former visibility,
      // pin state or id. The log states THAT a note was removed and by whom (D-99).
      return {
        primary: `${view.actorName} удалил заметку у ${view.targetUserName}`,
        detail: null,
      };
  }
}

/**
 * Note visibility axis. Phase 1B4-A writes `team` only (D-54); `private` is
 * readable by its author and `role_restricted` is always hidden (D-55), so the
 * last entry exists for exhaustiveness rather than for a screen that shows it.
 */
export const NOTE_VISIBILITY_LABEL: Record<NoteVisibility, string> = {
  team: "Командная заметка",
  private: "Приватная заметка",
  role_restricted: "Ограниченная заметка",
};

/**
 * Note visibility editing (Phase 1B5-C). Same single-source, no-raw-code,
 * no-diagnostics rule as the rest. The control label is a full instruction so a
 * screen reader hears the whole action, not a glyph. Nothing here interpolates a
 * note id, body or any bookkeeping. Only the two WRITABLE visibilities are offered
 * (D-91); `role_restricted` has no option.
 */
export const NOTE_VISIBILITY_EDIT_LABEL = {
  /** Opens the inline visibility editor for a note the actor authored. */
  editAction: "Изменить доступ к заметке",
  /** Select label inside the editor — distinct from the composer/body labels. */
  fieldLabel: "Доступ к заметке",
  /** Option captions — the enum values stay internal. */
  optionTeam: "Командная",
  optionPrivate: "Приватная",
  save: "Сохранить",
  cancel: "Отменить",
  /** Announced through the Save control while its own write is in flight. */
  pending: "Сохраняем…",
  success: "Доступ к заметке обновлён",
  /** Someone else changed it first; the list now shows what is actually stored. */
  conflict: "Доступ к заметке уже изменён. Показаны актуальные данные.",
} as const;

/**
 * Note deletion (Phase 1B6). Same single-source, no-raw-code, no-diagnostics rule as
 * the rest. The delete control's label is a full instruction so a screen reader hears
 * the whole action, not a glyph. The confirm copy is honest about permanence — there
 * is no undo — while pointing at the Audit trail that survives (D-96). Nothing here
 * interpolates a note id, body, visibility or any bookkeeping.
 */
export const NOTE_DELETE_LABEL = {
  /** Accessible name of the destructive control in a note row. */
  deleteAction: "Удалить заметку",
  /** Inline confirmation heading. */
  confirmTitle: "Удалить заметку?",
  /** Inline confirmation body — permanence + Audit survives. */
  confirmBody: "Действие нельзя отменить. История изменения останется в Audit.",
  /** Confirm button — the destructive commit. */
  confirm: "Удалить",
  cancel: "Отменить",
  /** Announced through the confirm control while its own write is in flight. */
  pending: "Удаляем…",
  /** Calm outcome line shown at the section level after the row vanishes. */
  success: "Заметка удалена",
  /** Someone else changed it first; the list now shows what is actually stored. */
  conflict: "Заметка уже изменена. Показаны актуальные данные.",
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

/**
 * Human labels for mock employee (owner) ids — DERIVED from the canonical
 * directory (Phase 1B4-C), not retyped here. A second hand-kept list is a list
 * that drifts, and this one already had: it carried nine ids while the Users
 * filter offered six and the fixtures used five.
 */
export const OWNER_LABEL: Record<string, string> = Object.fromEntries(
  EMPLOYEE_DIRECTORY.map((e) => [e.employeeId, e.displayName]),
);

/** Shown instead of an id we have no caption for. */
export const UNKNOWN_OWNER_LABEL = "Неизвестный сотрудник";

/**
 * Shown instead of a target user id the dataset cannot place (Phase 1B5-B). A raw
 * user id is never printed as a fallback — the audit view resolves the target's
 * display name, and this neutral caption stands in when there is none.
 */
export const UNKNOWN_USER_LABEL = "Неизвестный пользователь";

/**
 * `humanizeCode` is deliberately NOT the fallback here (Phase 1B4-C). It turns
 * `emp_xyz` into "Emp xyz", which is the raw id with a capital letter — an
 * employee id printed to the screen under the pretence of being a name. An
 * unknown employee gets a neutral caption instead; the code stays internal.
 */
export function ownerLabel(ownerId: string | null | undefined): string {
  if (!ownerId) return "Не назначен";
  return OWNER_LABEL[ownerId] ?? UNKNOWN_OWNER_LABEL;
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
