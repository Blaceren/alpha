/**
 * AFD-5C2 — every word the lead workspace displays.
 *
 * ONE PLACE DECIDES WHAT A STATE IS CALLED, because the honesty of this screen
 * lives almost entirely in its wording. Three distinctions are load-bearing and
 * are enforced here rather than left to whoever writes the next component:
 *
 *   • JOURNEY STAGE ≠ DEPOSIT STATE. The stage says how far a learner
 *     demonstrably got (the ledger); the deposit state says what condition the
 *     provider's own event is in. A conflict does not undo a counted deposit and
 *     a counted deposit does not resolve a conflict, so the two vocabularies
 *     share no phrase.
 *   • PENDING ≠ CONFIRMED. "Ожидает подтверждения Pocket-пользователя" never
 *     contains the word "депозит подтверждён", so a pending row cannot be
 *     skim-read as a conversion.
 *   • UNAVAILABLE ≠ ZERO. Every absence carries the reason it is absent. There is
 *     no label in this file that renders a missing capability as a number.
 *
 * NOTHING HERE INVENTS A FACT. Each label names a backend enum member; there is
 * no derived status, no computed "risk", no quality score and no forecast.
 */
import type {
  LeadAttributionState,
  LeadConflictCategory,
  LeadDatePreset,
  LeadDepositState,
  LeadIntegrityFlag,
  LeadJourneyStage,
  LeadSort,
  LeadTimelineEventType,
  LeadTimelineSourceCategory,
  LeadTimelineState,
  LeadTouchRole,
} from "@/data/contracts/api/affiliate-leads";
import type { LeadOutcome } from "@/application/api/affiliate-leads-client";

/* -------------------------------------------------------------- the section */

export const LEADS_TITLE = "Лиды аффилейтов";

export const LEADS_DESCRIPTION =
  "Учащиеся, зарегистрированные в Академии, с привязанной или прямой историей привлечения. " +
  "Список и карточка лида всегда показывают адрес в замаскированном виде.";

/* ------------------------------------------------------------------- stages */

/** The three milestones some immutable row proves happened. */
export const JOURNEY_STAGE_LABEL: Record<LeadJourneyStage, string> = {
  academy_registered: "Зарегистрирован в Академии",
  pocket_registered: "Зарегистрирован в Pocket",
  first_deposit_confirmed: "Первый депозит подтверждён",
};

export const JOURNEY_STAGE_HINT: Record<LeadJourneyStage, string> = {
  academy_registered: "Подтверждено событием регистрации в Академии",
  pocket_registered: "Подтверждено доверенной привязкой Pocket-аккаунта",
  first_deposit_confirmed: "Подтверждено записью первого депозита в реестре конверсий",
};

/**
 * The four provider-row states.
 *
 * `none` is deliberately NOT "депозита не было": no event is linked to this
 * lead, which is a different statement from "этот учащийся не пополнял счёт". A
 * deposit whose Pocket identity was never bound belongs to nobody by design.
 */
export const DEPOSIT_STATE_LABEL: Record<LeadDepositState, string> = {
  none: "Депозит не зафиксирован",
  pending_identity: "Ожидает подтверждения Pocket-пользователя",
  conflict: "Требует проверки конфликта",
  confirmed: "Первый депозит подтверждён",
};

export const DEPOSIT_STATE_HINT: Record<LeadDepositState, string> = {
  none: "К этому лиду не привязано ни одного депозитного события провайдера",
  pending_identity: "Депозит получен, но доверенная привязка Pocket-аккаунта ещё не подтверждена",
  conflict:
    "Повторная доставка от провайдера разошлась с исходной. Это вопрос к данным провайдера, " +
    "а не признак проблемы с аккаунтом учащегося в Академии",
  confirmed: "Депозит учтён в реестре конверсий",
};

export const ATTRIBUTION_STATE_LABEL: Record<LeadAttributionState, string> = {
  attributed: "С привлечением",
  unattributed: "Прямая регистрация",
};

export const ATTRIBUTION_STATE_HINT: Record<LeadAttributionState, string> = {
  attributed: "За регистрацией закреплён зафиксированный клик по партнёрской ссылке",
  unattributed: "Регистрация без партнёрского привлечения. Аффилейт не назначается",
};

export const CONFLICT_CATEGORY_LABEL: Record<LeadConflictCategory, string> = {
  click_id_mismatch: "Расхождение идентификатора клика",
  amount_mismatch: "Расхождение суммы",
  identity_owner_mismatch: "Расхождение владельца Pocket-аккаунта",
  click_owner_missing: "Владелец клика не найден",
};

/* -------------------------------------------------------------------- sorts */

export const SORT_LABEL: Record<LeadSort, string> = {
  registration_desc: "Регистрация в Академии — сначала новые",
  registration_asc: "Регистрация в Академии — сначала старые",
  acquisition_desc: "Привлечение — сначала новые",
  acquisition_asc: "Привлечение — сначала старые",
  pocket_registration_desc: "Регистрация в Pocket — сначала новые",
  first_deposit_desc: "Первый депозит — сначала новые",
};

/* ------------------------------------------------------------------ periods */

export const PRESET_LABEL: Record<LeadDatePreset, string> = {
  today: "Сегодня",
  yesterday: "Вчера",
  current_week: "Текущая неделя",
  previous_week: "Прошлая неделя",
  last_7_days: "Последние 7 дней",
  last_30_days: "Последние 30 дней",
  current_month: "Текущий месяц",
  previous_month: "Прошлый месяц",
  custom: "Произвольный период",
  all_time: "За всё время",
};

export const PRESET_ORDER: readonly LeadDatePreset[] = [
  "today",
  "yesterday",
  "current_week",
  "previous_week",
  "last_7_days",
  "last_30_days",
  "current_month",
  "previous_month",
  "all_time",
  "custom",
];

export const NO_PERIOD_LABEL = "Без ограничения";

export const REGISTRATION_PERIOD_LABEL = "Период регистрации в Академии";
export const ACQUISITION_PERIOD_LABEL = "Период привлечения";

export const REGISTRATION_PERIOD_HINT =
  "Отбор по моменту регистрации учащегося в Академии.";

export const ACQUISITION_PERIOD_HINT =
  "Отбор по зафиксированному атрибуционному клику. Применим только к лидам с привлечением.";

export const BOTH_PERIODS_NOTE =
  "Периоды независимы: если заданы оба, лид должен удовлетворять обоим условиям одновременно.";

export const PERIOD_CONTRACT_NOTE =
  "Границы периодов вычисляет сервер: Europe/Moscow, неделя с понедельника, интервал " +
  "[начало, конец). Браузер не пересчитывает даты.";

export const INTERVAL_CONVENTION_LABEL: Record<string, string> = {
  start_inclusive_end_exclusive: "начало включительно, конец не включая",
};

export function intervalConventionLabel(value: string): string {
  return INTERVAL_CONVENTION_LABEL[value] ?? value;
}

/* ---------------------------------------------------------------- timeline */

/**
 * The complete event catalog, in the backend's own vocabulary.
 *
 * `first_deposit_received_pending` is worded so it cannot be read as a
 * confirmation: it says the deposit arrived BEFORE the identity was confirmed,
 * which is exactly what the stored timestamps prove and nothing more.
 */
export const TIMELINE_EVENT_LABEL: Record<LeadTimelineEventType, string> = {
  acquisition_first_touch: "Первый контакт",
  acquisition_last_touch: "Последний контакт",
  acquisition_selected: "Выбранный атрибуционный контакт",
  academy_registration: "Регистрация в Академии",
  pocket_registration: "Регистрация в Pocket",
  first_deposit_received_pending: "FD получен до подтверждения личности",
  first_deposit_conflict_detected: "Обнаружен конфликт FD",
  first_deposit_confirmed: "Первый депозит подтверждён",
};

export const TOUCH_ROLE_LABEL: Record<LeadTouchRole, string> = {
  first_touch: "первый контакт",
  last_touch: "последний контакт",
  selected: "выбранный для атрибуции",
};

export const TIMELINE_SOURCE_LABEL: Record<LeadTimelineSourceCategory, string> = {
  acquisition: "Привлечение",
  academy: "Академия",
  provider_identity: "Pocket — личность",
  provider_deposit: "Pocket — депозит",
  conversion_ledger: "Реестр конверсий",
};

/**
 * The presentation state of one item.
 *
 * Each has a WORD, never only a colour: a reader who cannot distinguish the
 * border tints still gets "ожидание" and "конфликт" as text.
 */
export const TIMELINE_STATE_LABEL: Record<LeadTimelineState, string> = {
  recorded: "зафиксировано",
  pending: "ожидание",
  conflict: "конфликт",
  confirmed: "подтверждено",
};

export const TIMELINE_TITLE = "Фактическая хронология";

export const TIMELINE_NOTE =
  "Показаны только события, подтверждённые сохранёнными отметками времени. Пропуски не " +
  "достраиваются. Время указано в Europe/Moscow в порядке, заданном сервером.";

export const TIMELINE_EMPTY = "Событий с подтверждённым временем нет";

export function timelineTruncatedLabel(maxItems: number): string {
  return `Показаны первые ${maxItems} событий. Остальные не отображены.`;
}

/* -------------------------------------------------------- integrity flags */

/**
 * Findings about the SHAPE OF THE STORED DATA — never a SQL error, a row id or a
 * provider payload. They exist so a malformed lead is reported instead of
 * silently rendered as a clean one.
 */
export const INTEGRITY_FLAG_LABEL: Record<LeadIntegrityFlag, string> = {
  duplicate_academy_registration:
    "Несколько событий регистрации в Академии указывают на этого учащегося",
  attribution_clicks_incomplete:
    "Привлечение зафиксировано, но прочитать все связанные клики не удалось",
  pocket_identity_untrusted_source:
    "Привязка Pocket-аккаунта создана недоверенным источником и не засчитана как регистрация",
  multiple_provider_deposit_events:
    "К этому учащемуся относится несколько депозитных событий провайдера",
  deposit_pending_after_identity_binding:
    "Депозит остаётся в ожидании, хотя доверенная привязка Pocket уже существует",
  confirmed_deposit_without_provider_event:
    "В реестре есть подтверждённый депозит, за которым нет записи провайдера",
  duplicate_first_deposit_conversion:
    "Несколько событий первого депозита указывают на этого учащегося",
  negative_journey_duration:
    "Более позднее событие имеет более раннюю отметку времени, чем предшествующее",
  acquisition_after_registration:
    "Привлечение произошло позже регистрации, которую оно должно было вызвать",
};

export const INTEGRITY_TITLE = "Замечания к целостности данных";

export const INTEGRITY_NOTE =
  "Замечания описывают форму сохранённых данных. Порядок событий не изменяется и пропуски не " +
  "восстанавливаются — расхождение показывается, а не исправляется.";

export const INTEGRITY_ROW_MARK = "Есть замечания к данным";

/* --------------------------------------------------------- data availability */

export const AVAILABILITY_TITLE = "Доступность данных";

export const AVAILABILITY_CAPABILITY_LABEL: Record<string, string> = {
  acquisition: "История привлечения",
  academyRegistration: "Регистрация в Академии",
  pocketRegistration: "Регистрация в Pocket",
  firstDeposit: "Первый депозит",
  redeposit: "Повторные депозиты",
  currentBalance: "Текущий баланс",
  educationTimeline: "Хронология обучения",
  trafficSubParameters: "Субпараметры трафика",
};

/**
 * Why something is absent, in words an operator can act on.
 *
 * "Повторные депозиты" is NOT "0" and is NOT "нет данных": Pocket's callback
 * carries no transaction identifier, so a second deposit is indistinguishable
 * from a redelivery of the first, and the platform declines to invent the
 * distinction. Saying that is the whole point of this table.
 */
export const AVAILABILITY_REASON_LABEL: Record<string, string> = {
  direct_registration: "Прямая регистрация — партнёрское привлечение отсутствует",
  trusted_pocket_identity_absent: "Доверенная привязка Pocket-аккаунта отсутствует",
  provider_identity_not_yet_reconciled:
    "Депозит получен, но личность Pocket-пользователя ещё не сверена",
  provider_delivery_disagreed: "Повторная доставка провайдера разошлась с исходной",
  no_provider_deposit_event: "Депозитных событий провайдера по этому лиду нет",
  provider_transaction_identifier_missing:
    "Pocket не передаёт идентификатор транзакции, поэтому повторный депозит неотличим от " +
    "повторной доставки первого. Показатель не собирается",
  prohibited_not_collected:
    "Официального API баланса у Pocket нет, и торговый результат не собирается. Показатель " +
    "недоступен",
  authoritative_product_event_catalog_not_implemented:
    "Достоверных продуктовых событий обучения пока не существует. Коммерческая хронология не " +
    "включает поведение в обучении",
  sensitive_acquisition_metadata_not_exposed:
    "Чувствительные метаданные привлечения не раскрываются",
  no_confirmed_first_deposit: "Подтверждённого первого депозита нет",
  currency_unspecified: "Валюта суммы не задана, поэтому сумма не показывается",
  amount_not_canonical: "Сумма сохранена в неканоническом виде и не показывается",
};

export function availabilityReasonLabel(reason: string): string {
  return AVAILABILITY_REASON_LABEL[reason] ?? "Недоступно";
}

export const AVAILABLE_LABEL = "Доступно";

/* ------------------------------------------------------------- acquisition */

export const ACQUISITION_TITLE = "Привлечение";

export const ACQUISITION_FROZEN_NOTE =
  "Первый, последний и выбранный контакт показаны из зафиксированной записи привлечения. " +
  "Они не пересчитываются и не редактируются.";

export const DIRECT_ACQUISITION_NOTE =
  "Прямая регистрация: партнёрский клик за ней не закреплён. Аффилейт не назначается, и лид " +
  "не попадает в отчёты по партнёрам.";

export const ACQUISITION_MODEL_LABEL = "Модель атрибуции";
export const ACQUISITION_REASON_LABEL = "Причина выбора";
export const ACQUISITION_FROZEN_AT_LABEL = "Зафиксировано";
export const FIRST_TOUCH_LABEL = "Первый контакт";
export const LAST_TOUCH_LABEL = "Последний контакт";
export const SELECTED_TOUCH_LABEL = "Выбранный контакт";

/**
 * The attribution model and the selection reason, in words.
 *
 * THE RAW VALUE IS THE FALLBACK, NEVER A BLANK. These are backend strings, not a
 * closed enum in the contract, so a value this table does not know is displayed
 * AS ITSELF rather than hidden or replaced by a guess — an operator seeing
 * `some_new_model` learns something true, and an empty cell would not.
 */
export const ACQUISITION_MODEL_TEXT: Record<string, string> = {
  last_eligible_affiliate_click: "Последний подходящий партнёрский клик",
  first_eligible_affiliate_click: "Первый подходящий партнёрский клик",
};

export const SELECTION_REASON_TEXT: Record<string, string> = {
  registration_cookie: "Определён по атрибуционной cookie при регистрации",
  last_touch_within_window: "Последний контакт внутри окна атрибуции",
  single_click: "Единственный зафиксированный клик",
};

export function acquisitionModelText(value: string): string {
  return ACQUISITION_MODEL_TEXT[value] ?? value;
}

export function selectionReasonText(value: string): string {
  return SELECTION_REASON_TEXT[value] ?? value;
}

export const SUBPARAMETERS_NOTE =
  "Идентификаторы кликов, посетителей и Pocket-аккаунтов, а также субпараметры ссылок не " +
  "отображаются в CRM.";

/* ------------------------------------------------------------------ reveal */

export const REVEAL_ACTION_LABEL = "Показать данные пользователя";
export const REVEAL_PANEL_TITLE = "Данные пользователя";
export const REVEAL_HIDE_LABEL = "Скрыть данные пользователя";
export const REVEAL_CONFIRM_TITLE = "Показать данные пользователя?";
export const REVEAL_CONFIRM_SUBMIT = "Показать данные";
export const REVEAL_CONFIRM_CANCEL = "Отмена";

/**
 * The confirmation copy.
 *
 * THREE FACTS, NO WARNINGS. It says what will happen (one lead), that it is
 * recorded, and what a reasonable operator should do with the result. There is
 * no threat, no red banner and no "вы уверены?" — fear-based copy trains people
 * to click through it, and this dialog needs to be read.
 */
export const REVEAL_CONFIRM_POINTS: readonly string[] = [
  "Будут показаны данные только этого одного лида.",
  "Действие записывается в журнал аудита вместе с вашей учётной записью.",
  "Не переносите показанные данные во внешние инструменты без разрешённой рабочей цели.",
];

export const REVEAL_EPHEMERAL_NOTE =
  "Данные показываются только в этом окне и на это время. Они не сохраняются в адресной " +
  "строке, в браузере и в кэше: после закрытия, перехода к другому лиду или перезагрузки " +
  "страницы карточка снова станет замаскированной.";

export const REVEAL_AUDIT_ACK = "Показ данных записан в журнал аудита.";

export const REVEAL_EMAIL_LABEL = "Электронная почта";
export const REVEAL_NAME_LABEL = "Имя";
export const REVEAL_NAME_ABSENT = "Имя не указано";

export const REVEAL_UNAVAILABLE_NOTE =
  "Показ данных пользователя требует отдельного разрешения. Доступ к аналитике аффилейтов его " +
  "не даёт.";

/* ------------------------------------------------------------------ fields */

export const MASKED_EMAIL_LABEL = "Учащийся (замаскировано)";
export const REGISTERED_AT_LABEL = "Регистрация в Академии";
export const ACQUIRED_AT_LABEL = "Привлечение";
export const POCKET_AT_LABEL = "Регистрация в Pocket";
export const DEPOSIT_AT_LABEL = "Первый депозит";
export const AFFILIATE_LABEL = "Аффилейт";
export const CAMPAIGN_LABEL = "Кампания";
export const LINK_LABEL = "Ссылка";
export const ACQUISITION_COLUMN_LABEL = "Привлечение — аффилейт, кампания, ссылка";
export const JOURNEY_LABEL = "Этап пути";
export const DEPOSIT_LABEL = "Состояние депозита";
export const NOT_APPLICABLE = "—";

export const AMOUNT_LABEL = "Сумма первого депозита";
export const REPLAY_OBSERVED_LABEL = "Провайдер повторно доставлял это событие";

/* -------------------------------------------------------------- list states */

export const LIST_LOADING = "Загружаем лиды…";
export const FILTERS_LOADING = "Загружаем справочники фильтров…";
export const DETAIL_LOADING = "Загружаем карточку лида…";
export const REVEAL_LOADING = "Запрашиваем данные пользователя…";
export const NEXT_PAGE_LOADING = "Загружаем следующую страницу…";

export const LIST_EMPTY_TITLE = "Лидов пока нет";
export const LIST_EMPTY_DESCRIPTION =
  "Ни одной регистрации в Академии с событием привлечения ещё не зафиксировано.";

export const LIST_FILTERED_EMPTY_TITLE = "По выбранным фильтрам ничего не найдено";
export const LIST_FILTERED_EMPTY_DESCRIPTION =
  "Измените фильтры или сбросьте их, чтобы увидеть остальные лиды.";

export const RESET_FILTERS_LABEL = "Сбросить фильтры";
export const REFRESHING_LABEL = "Обновляется…";

export const PAGINATION_LABEL = "Постраничная навигация по лидам";
export const NEXT_PAGE_LABEL = "Следующая страница";
export const PREVIOUS_PAGE_LABEL = "Предыдущая страница";
export const FIRST_PAGE_LABEL = "К первой странице";

export function pageStatusLabel(page: number, rows: number): string {
  return `Страница ${page}, показано лидов: ${rows}`;
}

export const CURSOR_RESET_NOTICE =
  "Ссылка на страницу устарела или не соответствует текущим фильтрам. Показана первая страница.";

export const BACK_TO_LIST_LABEL = "К списку лидов";

/* ------------------------------------------------------------------ errors */

/**
 * Backend message keys, translated.
 *
 * `crm.leads.pii_forbidden` and `crm.leads.lead_not_found` deliberately do NOT
 * differ in a way that reveals whether an unauthorised lead exists: the reveal
 * route checks the permission before it looks anything up, so an analyst probing
 * references sees the permission message either way, and this table does not
 * reintroduce the distinction.
 */
export const LEAD_MESSAGE: Record<string, string> = {
  "crm.leads.query_unknown": "В запросе есть неизвестный параметр",
  "crm.leads.query_duplicated": "Параметр запроса указан несколько раз",
  "crm.leads.filter_invalid": "Некорректное значение фильтра",
  "crm.leads.attribution_state_invalid": "Некорректное состояние привлечения",
  "crm.leads.journey_stage_invalid": "Некорректный этап пути",
  "crm.leads.deposit_state_invalid": "Некорректное состояние депозита",
  "crm.leads.sort_invalid": "Некорректная сортировка",
  "crm.leads.limit_invalid": "Некорректный размер страницы",
  "crm.leads.cursor_invalid": CURSOR_RESET_NOTICE,
  "crm.leads.cursor_filter_mismatch": CURSOR_RESET_NOTICE,
  "crm.leads.period_preset_required": "Для произвольного периода выберите пресет «Произвольный период»",
  "crm.leads.acquisition_period_requires_attribution":
    "Период привлечения применим только к лидам с привлечением",
  "crm.leads.lead_id_invalid": "Некорректная ссылка на лида",
  "crm.leads.lead_id_unsupported_version": "Ссылка на лида создана другой версией CRM",
  "crm.leads.lead_not_found": "Лид не найден",
  "crm.leads.pii_forbidden": "Недостаточно прав для показа данных пользователя",
  "crm.leads.reveal_body_not_allowed": "Запрос показа данных не принимает содержимое",
  "crm.affiliates.csrf_invalid": "Проверка безопасности не пройдена. Обновите страницу и повторите",
  "crm.affiliates.forbidden": "Недостаточно прав для этого раздела",
  "crm.analytics.preset_invalid": "Некорректный период",
  "crm.analytics.dates_not_allowed": "Даты допустимы только для произвольного периода",
  "crm.analytics.range_invalid": "Некорректный интервал дат",
  "crm.analytics.timezone_invalid": "Часовой пояс отчётности настроен некорректно",
};

export const GENERIC_FAILURE = "Не удалось загрузить данные. Попробуйте ещё раз";
export const UNAUTHENTICATED_MESSAGE = "Сессия истекла. Войдите снова, чтобы продолжить";
export const FORBIDDEN_MESSAGE = "Недостаточно прав для просмотра лидов аффилейтов";
export const NOT_FOUND_MESSAGE = "Лид не найден";
export const UPSTREAM_MESSAGE = "Сервис лидов недоступен. Попробуйте позже";
export const MALFORMED_MESSAGE =
  "Ответ сервиса не соответствует ожидаемому формату. Данные не показаны";
export const RATE_LIMITED_MESSAGE = "Слишком много запросов. Подождите немного и повторите";
export const CSRF_UNAVAILABLE_MESSAGE =
  "Не удалось получить токен безопасности. Обновите страницу и повторите";
export const TIMEOUT_MESSAGE = "Запрос занял слишком много времени. Попробуйте ещё раз";

export function describeLeadFailure(outcome: LeadOutcome<unknown>): string {
  switch (outcome.status) {
    case "success":
    case "cancelled":
      return "";
    case "unauthenticated":
      return UNAUTHENTICATED_MESSAGE;
    case "forbidden":
      return LEAD_MESSAGE[outcome.messageKey] ?? FORBIDDEN_MESSAGE;
    case "not_found":
      return LEAD_MESSAGE[outcome.messageKey] ?? NOT_FOUND_MESSAGE;
    case "cursor_invalid":
      return CURSOR_RESET_NOTICE;
    case "invalid_input":
    case "misconfigured":
      return LEAD_MESSAGE[outcome.messageKey] ?? GENERIC_FAILURE;
    case "csrf_unavailable":
      return CSRF_UNAVAILABLE_MESSAGE;
    case "rate_limited":
      return RATE_LIMITED_MESSAGE;
    case "malformed_response":
      return MALFORMED_MESSAGE;
    case "upstream_unavailable":
      return UPSTREAM_MESSAGE;
    default:
      return GENERIC_FAILURE;
  }
}

export function failureRequestId(outcome: LeadOutcome<unknown>): string | undefined {
  return "requestId" in outcome ? outcome.requestId : undefined;
}

/* ------------------------------------------------------------- formatting */

/**
 * A timestamp, as Europe/Moscow wall-clock text.
 *
 * THE BROWSER NEVER CONVERTS. The detail response carries `localOccurredAt`
 * already rendered by the backend for timeline items, and this helper exists for
 * the list and the summaries, where only an ISO instant is available. It formats
 * with an EXPLICIT `timeZone: "Europe/Moscow"` rather than the browser's own, so
 * an operator in Kaliningrad and one in Vladivostok read the same wall clock —
 * which is the only reading that matches the periods the backend resolves.
 */
const MOSCOW_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatInstant(iso: string | null): string {
  if (iso === null) return NOT_APPLICABLE;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return NOT_APPLICABLE;
  return MOSCOW_FORMAT.format(value);
}

/** The same instant, spelled out for a screen reader. */
export function instantAccessibleLabel(iso: string | null): string {
  return iso === null ? "время не зафиксировано" : `${formatInstant(iso)} по времени Europe/Moscow`;
}

/**
 * The first-deposit amount.
 *
 * Returns null whenever the backend did not state a currency. There is no branch
 * that produces a bare number and no USD fallback — an amount whose unit nobody
 * stated is withheld, because only an explicit absence gets questioned.
 */
export function formatDepositAmount(
  amount: string | null,
  currencyCode: string | null,
  availability: { available: boolean },
): string | null {
  if (!availability.available) return null;
  if (amount === null || currencyCode === null) return null;
  return `${amount} ${currencyCode}`;
}
