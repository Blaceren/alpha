/**
 * AFD-5A — Russian copy and the backend-error mapping for the affiliate
 * workspace.
 *
 * WHY THE MAPPING IS CLOSED. The backend's `messageKey` is a stable identifier,
 * not user-facing text. It is looked up here and NEVER rendered directly: an
 * unrecognised key falls back to a generic Russian sentence. That is what keeps
 * a future backend key — or an error body from something that is not our
 * backend — from printing an English identifier, a SQL fragment, a file path or
 * a stack frame into the UI.
 */
import type { AffiliateOutcome } from "@/application/api/affiliates-client";
import type {
  AffiliateAvailability,
  AffiliateEntityStatus,
  AffiliateLinkStatus,
} from "@/data/contracts/api/affiliates";

/* ------------------------------------------------------------------ status */

export const ENTITY_STATUS_LABEL: Record<AffiliateEntityStatus, string> = {
  active: "Активен",
  paused: "На паузе",
  archived: "В архиве",
};

export const LINK_STATUS_LABEL: Record<AffiliateLinkStatus, string> = {
  draft: "Черновик",
  active: "Активна",
  paused: "На паузе",
  archived: "В архиве",
};

export const AVAILABILITY_LABEL: Record<AffiliateAvailability, string> = {
  available: "Доступен",
  paused: "Недоступен (пауза)",
  archived: "Недоступен (архив)",
};

/**
 * Tone is decoration only. Every badge in this workspace also renders its text
 * label, so status is never communicated by colour alone.
 */
export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

export const STATUS_TONE: Record<string, Tone> = {
  active: "success",
  paused: "warning",
  archived: "neutral",
  draft: "info",
  available: "success",
};

export function statusTone(value: string): Tone {
  return STATUS_TONE[value] ?? "neutral";
}

/* ---------------------------------------------- effective availability copy */

/**
 * The explanation shown beside a link's status. Each string names the ACTUAL
 * blocking fact, because "недоступна" on its own sends an operator hunting
 * through three screens to find out why.
 */
export const PUBLIC_ROUTE_STATE_LABEL: Record<string, string> = {
  serving: "Принимает трафик",
  feature_disabled: "Атрибуция отключена в этой среде",
  not_active: "Ссылка не активирована",
  parent_paused: "Родительский аффилейт или кампания на паузе",
  parent_archived: "Родительский аффилейт или кампания в архиве",
};

export const ACTIVATION_STATE_LABEL: Record<string, string> = {
  available: "Можно активировать",
  feature_disabled: "Активация недоступна: атрибуция отключена",
  blocked: "Активация недоступна: не выполнены условия",
  terminal: "Архив — активация невозможна",
};

export function publicRouteStateLabel(state: string): string {
  return PUBLIC_ROUTE_STATE_LABEL[state] ?? "Состояние неизвестно";
}

export function activationStateLabel(state: string): string {
  return ACTIVATION_STATE_LABEL[state] ?? "Состояние неизвестно";
}

/* ------------------------------------------------------------------ errors */

/**
 * Stable backend `messageKey` → Russian sentence.
 *
 * Deliberately explicit rather than generated: each entry is a sentence an
 * operator can act on, and a key with no entry must fall back rather than leak.
 */
const MESSAGE_KEY_TEXT: Record<string, string> = {
  // validation
  "crm.affiliates.code_invalid":
    "Код должен содержать 3–64 символа: строчные латинские буквы, цифры, дефис или подчёркивание.",
  "crm.affiliates.display_name_invalid": "Укажите название длиной от 1 до 160 символов.",
  "crm.affiliates.description_invalid": "Описание слишком длинное (максимум 2000 символов).",
  "crm.affiliates.notes_invalid": "Заметки слишком длинные (максимум 2000 символов).",
  "crm.affiliates.window_invalid": "Окно атрибуции должно быть целым числом от 1 до 365 дней.",
  "crm.affiliates.body_invalid": "Некорректные данные формы.",
  "crm.affiliates.body_unknown_field": "Форма отправила поле, которое сервер не принимает.",
  "crm.affiliates.body_too_large": "Слишком большой объём данных.",
  "crm.affiliates.id_invalid": "Некорректный идентификатор.",
  "crm.affiliates.limit_invalid": "Некорректный размер страницы.",
  "crm.affiliates.offset_invalid": "Некорректное смещение страницы.",
  "crm.affiliates.search_invalid": "Поисковый запрос слишком длинный (максимум 100 символов).",
  "crm.affiliates.status_invalid": "Некорректный статус.",
  "crm.affiliates.query_unknown": "Некорректные параметры запроса.",
  "crm.affiliates.query_duplicated": "Параметр запроса указан дважды.",

  // conflicts and transitions
  "crm.affiliates.code_conflict": "Аффилейт с таким кодом уже существует.",
  "crm.affiliates.campaign.code_conflict":
    "Кампания с таким кодом уже существует у этого аффилейта.",
  "crm.affiliates.status_unchanged": "Этот статус уже установлен.",
  "crm.affiliates.status_transition_invalid":
    "Такой переход статуса запрещён. Архив — необратимое состояние.",
  "crm.affiliates.reference_not_found":
    "Указанный аффилейт или кампания не найдены либо кампания принадлежит другому аффилейту.",
  "crm.affiliates.not_found": "Запись не найдена.",
  "crm.affiliates.partner.not_found": "Аффилейт не найден.",
  "crm.affiliates.campaign.not_found": "Кампания не найдена.",
  "crm.affiliates.link.not_found": "Ссылка не найдена.",

  // tracking links
  "crm.affiliates.link.parameter_protected":
    "Это имя параметра зарезервировано и не может использоваться.",
  "crm.affiliates.link.parameter_invalid":
    "Имя параметра: 1–32 символа, только строчные латинские буквы, цифры и подчёркивание.",
  "crm.affiliates.link.parameter_duplicate": "Имена параметров не должны повторяться.",
  "crm.affiliates.link.landing_key_invalid": "Неподдерживаемый тип посадочной страницы.",
  "crm.affiliates.link.public_code_invalid": "Некорректный публичный код ссылки.",
  "crm.affiliates.link.public_code_exhausted":
    "Не удалось сгенерировать уникальный код. Повторите попытку.",
  "crm.affiliates.link.attribution_disabled":
    "Атрибуция отключена в этой среде, поэтому ссылку нельзя активировать.",
  "crm.affiliates.link.conflict": "Конфликт при сохранении ссылки.",

  // authorization / session
  "crm.affiliates.forbidden": "Недостаточно прав для этого действия.",
  "crm.affiliates.csrf_invalid": "Сессия устарела. Обновите страницу и повторите попытку.",
  "crm.affiliates.csrf_unavailable":
    "Не удалось подтвердить сессию. Обновите страницу и повторите попытку.",
  "crm.session.unauthenticated": "Сессия завершена. Войдите снова.",
  "crm.affiliates.internal": "Внутренняя ошибка сервера.",
};

/** The stable activation-refusal code the backend returns as `code`. */
const ERROR_CODE_TEXT: Record<string, string> = {
  AFFILIATE_ATTRIBUTION_DISABLED:
    "Атрибуция отключена в этой среде, поэтому ссылку нельзя активировать.",
};

export const GENERIC_ERROR = "Не удалось выполнить операцию. Повторите попытку.";

/**
 * Turn a failed outcome into one Russian sentence.
 *
 * Transport-level states are described in the CRM's own words — they have no
 * backend message and must never be reported as "unknown error".
 */
export function describeAffiliateFailure(outcome: AffiliateOutcome<unknown>): string {
  switch (outcome.status) {
    case "success":
      return "";
    case "unauthenticated":
      return "Сессия завершена. Войдите снова.";
    case "rate_limited":
      return "Слишком много запросов. Подождите немного и повторите.";
    case "upstream_unavailable":
      return "Сервер недоступен или превышено время ожидания. Повторите попытку.";
    case "malformed_response":
      return "Сервер вернул неожиданный ответ. Обновите страницу.";
    default: {
      const key = (outcome as { messageKey?: string }).messageKey;
      const mapped = key ? (MESSAGE_KEY_TEXT[key] ?? ERROR_CODE_TEXT[key]) : undefined;
      if (mapped) return mapped;
      if (outcome.status === "forbidden") return "Недостаточно прав для этого действия.";
      if (outcome.status === "not_found") return "Запись не найдена.";
      return GENERIC_ERROR;
    }
  }
}

/** The support reference an operator can quote. Never a stack or a body. */
export function failureRequestId(outcome: AffiliateOutcome<unknown>): string | undefined {
  return (outcome as { requestId?: string }).requestId;
}

/* ------------------------------------------------------------------- misc */

export function formatDateTime(iso: string): string {
  // Fixed locale and explicit fields: an operator comparing two rows must not
  // see two different formats because of a browser setting.
  return new Date(iso).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function pluralDays(days: number): string {
  const mod10 = days % 10;
  const mod100 = days % 100;
  if (mod10 === 1 && mod100 !== 11) return `${days} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${days} дня`;
  return `${days} дней`;
}
