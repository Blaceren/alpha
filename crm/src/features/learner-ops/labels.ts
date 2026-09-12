/**
 * LEARNER-OPERATIONS-V1 — the Russian operational vocabulary.
 *
 * Every machine code the backend can send has exactly one label here. A code
 * with no label renders as the RAW CODE rather than as an invented phrase —
 * a missing label is a bug that should be visible, not smoothed over, and a
 * previous phase in this repository shipped a raw enum to a learner precisely
 * because a fallback quietly hid one.
 *
 * These are OPERATIONAL words, deliberately not educational ones. A case is
 * "решено"; a level is "завершён". The two vocabularies stay apart because
 * merging them is how an operational status starts reading as a progression
 * fact.
 */
import type {
  LearnerOpsPriority,
  LearnerOpsStatus,
  LearnerOpsType,
} from "@/data/contracts/api/learner-ops";

export const STATUS_LABEL: Record<LearnerOpsStatus, string> = {
  new: "Новое",
  open: "Открыто",
  in_progress: "В работе",
  waiting_learner: "Ждём ученика",
  waiting_internal: "Ждём решения",
  waiting_external: "Ждём провайдера",
  escalated: "Эскалировано",
  resolved: "Решено",
  closed: "Закрыто",
};

export const TYPE_LABEL: Record<LearnerOpsType, string> = {
  support_request: "Обращение",
  report_review: "Проверка отчёта",
  mentor_review: "Проверка практики",
  educational_escalation: "Учебная эскалация",
  complaint: "Жалоба",
  service_recovery: "Восстановление сервиса",
  operational_followup: "Сопровождение",
};

export const PRIORITY_LABEL: Record<LearnerOpsPriority, string> = {
  urgent: "Срочно",
  high: "Высокий",
  normal: "Обычный",
  low: "Низкий",
};

export const ESCALATION_CLASS_LABEL: Record<string, string> = {
  educational_methodology: "Методология",
  technical_product: "Технический баг",
  external_provider: "Внешний провайдер",
  security_abuse: "Безопасность",
  operational_lead: "Руководитель операций",
};

export const QA_RESULT_LABEL: Record<string, string> = {
  meets: "Соответствует",
  needs_improvement: "Требует улучшения",
  does_not_meet: "Не соответствует",
};

export const VOC_STATUS_LABEL: Record<string, string> = {
  open: "Открыт",
  under_review: "На рассмотрении",
  accepted: "Принят",
  rejected: "Отклонён",
  resolved: "Решён",
};

export const VOC_SEVERITY_LABEL: Record<string, string> = {
  critical: "Критично",
  high: "Высоко",
  medium: "Средне",
  low: "Низко",
};

export const KNOWLEDGE_STATUS_LABEL: Record<string, string> = {
  draft: "Черновик",
  published: "Опубликовано",
  archived: "В архиве",
};

export const EVENT_LABEL: Record<string, string> = {
  created: "Создано",
  status_changed: "Смена статуса",
  assigned: "Назначено",
  reassigned: "Переназначено",
  unassigned: "Снято назначение",
  priority_changed: "Смена приоритета",
  message_sent: "Ответ ученику",
  note_added: "Внутренняя заметка",
  escalated: "Эскалация",
  escalation_resolved: "Эскалация закрыта",
  first_response_recorded: "Первый ответ",
  resolved: "Решено",
  closed: "Закрыто",
  reopened: "Переоткрыто",
  qa_reviewed: "Оценка качества",
  canonical_decision_mirrored: "Решение канонического владельца",
};

/**
 * The SLA clock states.
 *
 * `none` is "цель не задана", NOT "выполнено". A target nobody chose has not
 * been achieved — it does not exist — and labelling it as success would turn
 * the absence of a policy into a green tick.
 */
export const SLA_STATE_LABEL: Record<string, string> = {
  none: "Цель не задана",
  running: "Идёт",
  paused: "На паузе",
  met: "Выполнено",
  breached: "Просрочено",
  stopped: "Остановлено",
};

/**
 * SLA provenance, rendered beside every target.
 *
 * The product owner has supplied no business SLA durations, so every seeded
 * policy is an acceptance fixture and the CRM says so in words. A fixture shown
 * as policy would be an invented business commitment.
 */
export const SLA_ORIGIN_LABEL: Record<string, string> = {
  preprod_acceptance_fixture: "PREPROD-фикстура (не бизнес-политика)",
  product_owner_supplied: "Утверждено владельцем продукта",
};

/**
 * The evidence that answered the first-deposit question. Rendered verbatim so
 * an operator can tell the canonical ledger from the closed legacy set, rather
 * than being told a bare yes or no.
 */
export const FIRST_DEPOSIT_EVIDENCE_LABEL: Record<string, string> = {
  canonical_conversion: "Канонический реестр конверсий",
  legacy_account_record: "Legacy-запись аккаунта (до реестра)",
  none: "Подтверждения нет",
};

/** A code with no label renders as itself — see the header. */
export function label(map: Record<string, string>, code: string): string {
  return map[code] ?? code;
}

/** Coarse elapsed time. Triage precision, not a stopwatch. */
export function since(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return "—";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "—";
  const minutes = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  return `${Math.floor(hours / 24)} дн`;
}

export function duration(ms: number | null): string {
  if (ms === null) return "—";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч ${minutes % 60} мин`;
  return `${Math.floor(hours / 24)} дн ${hours % 24} ч`;
}

export function dateTime(iso: string | null): string {
  if (iso === null) return "—";
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "—";
  return value.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The closed outcome vocabulary, in operator language. */
export function outcomeNote(status: string, detail?: string): string {
  switch (status) {
    case "forbidden":
      return "У вашей роли нет прав на это действие.";
    case "unauthenticated":
      return "Сессия истекла. Войдите заново.";
    case "not_found":
      return "Объект не найден. Обновите список.";
    case "conflict":
      return detail
        ? `Состояние изменилось: ${detail}. Обновите и повторите.`
        : "Кто-то изменил объект раньше вас. Обновите и повторите.";
    case "invalid_input":
      return detail ? `Некорректные данные: ${detail}` : "Некорректные данные.";
    case "malformed_response":
      return "Ответ сервера не распознан. Ничего не показано.";
    case "unavailable":
      return "Сервис недоступен. Повторите позже.";
    default:
      return "Не удалось выполнить действие.";
  }
}
