/**
 * AFD-5C1 — Russian copy, and the three formatters that must not lie.
 *
 * The backend publishes exact decimal STRINGS and explicit absences. The whole
 * risk of this file is that formatting quietly turns one into the other, so each
 * formatter below states what it refuses to do:
 *
 *   formatRatio    — never renders null as "0 %"
 *   formatAmount   — never renders a total without a currency, never assumes USD
 *   formatDuration — never rounds a non-zero duration down to zero
 *
 * Every `messageKey` from the backend is looked up in a CLOSED map and never
 * rendered directly, exactly as AFD-5A established: an unrecognised key falls
 * back to a generic Russian sentence rather than printing an English identifier,
 * a SQL fragment or a file path into the UI.
 */
import type { AnalyticsOutcome } from "@/application/api/affiliate-analytics-client";
import type {
  AmountAvailability,
  AvailabilityState,
  BucketGroup,
  DatePreset,
  MedianLag,
} from "@/data/contracts/api/affiliate-analytics";
import type { AnalyticsMode, CoverageView } from "./analytics-url-state";

/* ------------------------------------------------------------------- modes */

export const MODE_LABEL: Record<AnalyticsMode, string> = {
  event_date: "По дате события",
  acquisition_cohort: "По когорте привлечения",
};

export const MODE_DESCRIPTION: Record<AnalyticsMode, string> = {
  event_date: "События, произошедшие внутри выбранного периода",
  acquisition_cohort: "Зарегистрированные пользователи, привлечённые в выбранном периоде",
};

/* ----------------------------------------------------------------- periods */

export const PRESET_LABEL: Record<DatePreset, string> = {
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

export const PRESET_ORDER: readonly DatePreset[] = [
  "today",
  "yesterday",
  "current_week",
  "previous_week",
  "last_7_days",
  "last_30_days",
  "current_month",
  "previous_month",
  "custom",
  "all_time",
];

export const GROUP_LABEL: Record<BucketGroup, string> = {
  day: "По дням",
  week: "По неделям",
  month: "По месяцам",
};

export const COVERAGE_LABEL: Record<CoverageView, string> = {
  total: "Всего",
  attributed: "С атрибуцией",
  unattributed: "Без атрибуции",
};

export const COVERAGE_DESCRIPTION: Record<CoverageView, string> = {
  total: "Все события периода: и привлечённые аффилейтами, и прямые",
  attributed: "Только события, привязанные к аффилейту, кампании или ссылке",
  unattributed: "Прямые события без атрибуционного клика. Это отчётная категория, а не аффилейт",
};

/* ----------------------------------------------------------------- metrics */

export const METRIC_LABEL = {
  rawClicks: "Сырые клики",
  qualifiedClicks: "Квалифицированные клики",
  prefetchClicks: "Prefetch-клики",
  authenticatedUserClicks: "Клики авторизованных пользователей",
  uniqueVisitors: "Уникальные посетители",
  academyRegistrations: "Регистрации в Академии",
  pocketRegistrations: "Регистрации в Pocket",
  confirmedFirstDeposits: "Первые депозиты",
  pendingIdentityDeposits: "FD в ожидании идентификации",
  conflictingDeposits: "FD с конфликтом",
} as const;

export const METRIC_HINT: Partial<Record<keyof typeof METRIC_LABEL, string>> = {
  qualifiedClicks: "Клики, прошедшие классификацию: без prefetch и без авторизованных пользователей",
  uniqueVisitors:
    "Различные анонимные посетители за весь период. Не равно сумме по столбцам графика",
  pendingIdentityDeposits: "Депозит получен, но пользователь ещё не сопоставлен",
  conflictingDeposits: "Депозит противоречит уже связанной учётной записи",
};

export const COHORT_METRIC_LABEL = {
  cohortLearners: "Пользователи в когорте",
  pocketRegisteredLearners: "Зарегистрировались в Pocket",
  firstDepositLearners: "Сделали первый депозит",
} as const;

/* ------------------------------------------------------------------ ratios */

export const RATIO_LABEL = {
  qualifiedClickToAcademyRegistrationRate: "Клик → регистрация в Академии",
  academyRegistrationToPocketRegistrationRate: "Академия → Pocket",
  pocketRegistrationToFirstDepositRate: "Pocket → первый депозит",
  qualifiedClickToPocketRegistrationRate: "Клик → регистрация в Pocket",
  qualifiedClickToFirstDepositRate: "Клик → первый депозит",
} as const;

export const COHORT_RATE_LABEL = {
  pocketRegistrationRate: "Дошли до Pocket",
  firstDepositRate: "Дошли до первого депозита",
  pocketToFirstDepositRate: "Из Pocket в первый депозит",
} as const;

export const DENOMINATOR_LABEL: Record<string, string> = {
  qualifiedClicks: "квалифицированные клики",
  academyRegistrations: "регистрации в Академии",
  pocketRegistrations: "регистрации в Pocket",
  cohortLearners: "пользователи в когорте",
  pocketRegisteredLearners: "зарегистрировались в Pocket",
};

/** The neutral state shown when a ratio has no denominator to divide by. */
export const INSUFFICIENT_DATA = "Недостаточно данных";

/**
 * Render an exact decimal ratio string as a percentage.
 *
 * NULL IS NOT ZERO, AND THIS IS THE ONLY PLACE THAT DECIDES SO. The backend
 * returns null when the denominator is zero — "nobody clicked" — and `"0"` when
 * the denominator is real and the numerator is not. Rendering the first as
 * "0 %" would state that a hundred clicks produced no registrations when in
 * fact there were no clicks. The two are given visibly different output.
 *
 * The multiplication is done on a Number only AFTER the null check, and only for
 * display: the exact source string is carried alongside by the caller for the
 * accessible description, so nothing rounded here is ever the authoritative
 * value.
 */
export function formatRatio(value: string | null): string {
  if (value === null) return INSUFFICIENT_DATA;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return INSUFFICIENT_DATA;
  const percent = numeric * 100;
  // A tiny but non-zero rate keeps a visible magnitude instead of collapsing to
  // "0 %", which would read as "never happens".
  if (percent > 0 && percent < 0.1) return "< 0,1 %";
  const rendered = percent.toFixed(percent < 10 ? 2 : 1).replace(".", ",");
  return `${rendered} %`;
}

/** True when a ratio is genuinely absent rather than genuinely zero. */
export function isRatioUnavailable(value: string | null): boolean {
  return value === null;
}

/* ------------------------------------------------------------------ counts */

/** Thin space separators, so 12345 reads as 12 345 rather than 12,345. */
export function formatCount(value: number): string {
  return value.toLocaleString("ru-RU").replace(/ /g, " ");
}

/* ----------------------------------------------------------------- amounts */

export const AMOUNT_UNAVAILABLE_REASON: Record<string, string> = {
  currency_unspecified_or_mixed:
    "Сумма не рассчитана: валюта не указана или в периоде несколько валют. " +
    "Конвертация не выполняется, поэтому итог не показывается.",
  no_confirmed_first_deposits: "В выбранном периоде нет подтверждённых первых депозитов",
};

export function amountUnavailableReason(reason: string): string {
  return AMOUNT_UNAVAILABLE_REASON[reason] ?? "Сумма недоступна в этом периоде";
}

/**
 * Render the first-deposit total, or explain why there is none.
 *
 * THE CURRENCY IS NEVER INVENTED. The available branch of the contract carries
 * both the total and its code, and the unavailable branch carries neither — so
 * there is no path here that prints a bare number, substitutes USD, or adds two
 * currencies together. The label is "Сумма первых депозитов" and deliberately
 * not "выручка", "баланс", "прибыль" or "LTV": this is the money that arrived at
 * the broker, not revenue the Academy earned.
 */
export function formatAmount(amount: AmountAvailability): string | null {
  if (!amount.amountAggregationAvailable) return null;
  const numeric = Number(amount.amountTotal);
  const rendered = Number.isFinite(numeric)
    ? numeric.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : amount.amountTotal;
  return `${rendered.replace(/ /g, " ")} ${amount.currencyCode}`;
}

export const AMOUNT_TITLE = "Сумма первых депозитов";

/* --------------------------------------------------------------- durations */

/**
 * Russian plural selection: 1 день / 2 дня / 5 дней.
 */
function plural(value: number, one: string, few: string, many: string): string {
  const abs = Math.abs(value) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

/**
 * Render an exact decimal-seconds string as a human duration.
 *
 * NOTHING IS ROUNDED TO ZERO. A lag of half a second renders as "0,5 сек", not
 * "0 сек" — a median that reads as instantaneous when it is not would be the
 * formatter inventing a business fact. The half-second precision is real: the
 * median of an even population of whole seconds is exactly `.0` or `.5`, and the
 * backend renders it losslessly as a string.
 *
 * THE EXACT SOURCE VALUE SURVIVES. `exactSeconds` below returns the untouched
 * backend string for the accessible description and the tooltip, so the display
 * form is a convenience and never the record.
 *
 * NO AVERAGE LANGUAGE. This is a median and the labels say so; a mean is neither
 * computed by the backend nor implied here.
 */
export function formatDuration(seconds: string | null): string | null {
  if (seconds === null) return null;
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return null;

  if (value === 0) return "0 сек";

  if (value < 60) {
    // Preserve the fractional half-second rather than rounding it away.
    const rendered = Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
    return `${rendered} сек`;
  }

  if (value < 3600) {
    const minutes = Math.floor(value / 60);
    const rest = Math.round(value % 60);
    const head = `${minutes} ${plural(minutes, "минута", "минуты", "минут")}`;
    return rest === 0 ? head : `${head} ${rest} сек`;
  }

  if (value < 86_400) {
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const head = `${hours} ${plural(hours, "час", "часа", "часов")}`;
    return minutes === 0 ? head : `${head} ${minutes} мин`;
  }

  const days = Math.floor(value / 86_400);
  const hours = Math.floor((value % 86_400) / 3600);
  const head = `${days} ${plural(days, "день", "дня", "дней")}`;
  return hours === 0 ? head : `${head} ${hours} ч`;
}

/** The untouched backend value, for accessible descriptions and tooltips. */
export function exactSeconds(seconds: string | null): string | null {
  return seconds === null ? null : `${seconds.replace(".", ",")} сек`;
}

/** Whole seconds from follow-up metadata, through the same formatter. */
export function formatFollowupSeconds(seconds: number | null): string | null {
  return seconds === null ? null : formatDuration(String(seconds));
}

export function formatSampleSize(size: number): string {
  return `${formatCount(size)} ${plural(size, "наблюдение", "наблюдения", "наблюдений")}`;
}

/** A median with no observations is unavailable, never zero. */
export function medianIsUnavailable(median: MedianLag): boolean {
  return median.medianSeconds === null || median.sampleSize === 0;
}

export const MEDIAN_LABEL = {
  selectedClickToAcademyRegistration: "Клик → регистрация в Академии",
  academyRegistrationToPocketRegistration: "Академия → Pocket",
  pocketRegistrationToFirstDeposit: "Pocket → первый депозит",
  selectedClickToFirstDeposit: "Клик → первый депозит",
} as const;

/* ------------------------------------------------------------ availability */

/**
 * Why a capability is unavailable, in operator language.
 *
 * Each string names the ACTUAL blocking fact rather than the phase that will fix
 * it: "недоступно" alone sends somebody hunting through three screens.
 */
export const UNAVAILABLE_REASON_LABEL: Record<string, string> = {
  provider_transaction_identifier_missing:
    "Pocket не передаёт идентификатор транзакции, поэтому повторный депозит " +
    "неотличим от повторной доставки первого",
  prohibited_not_collected: "Данные не собираются",
  authoritative_product_event_catalog_not_implemented:
    "Каталог продуктовых событий ещё не определён",
  unregistered_visitor_selected_attribution_not_frozen:
    "У незарегистрированного посетителя нет зафиксированного атрибуционного клика",
  no_selected_acquisition_click: "Нет выбранного атрибуционного клика",
  acquisition_anchor_absent: "У прямых регистраций нет атрибуционного клика — якоря когорты",
  deferred_to_statistical_analyst_phase: "Оценка зрелости когорты не реализована",
  deferred_to_predictive_analytics_phase: "Прогнозирование не реализовано",
  currency_unspecified_or_mixed: "Валюта не указана или в периоде несколько валют",
  no_confirmed_first_deposits: "Нет подтверждённых первых депозитов",
};

export function unavailableReasonLabel(reason: string): string {
  return UNAVAILABLE_REASON_LABEL[reason] ?? "Недоступно в этой конфигурации";
}

export function availabilityText(state: AvailabilityState): string {
  return state.available ? "Доступно" : unavailableReasonLabel(state.reason);
}

/** Capability names for the "Доступность данных" section. */
export const CAPABILITY_LABEL: Record<string, string> = {
  trafficClicks: "Клики и трафик",
  academyRegistrations: "Регистрации в Академии",
  pocketRegistrations: "Регистрации в Pocket",
  firstDeposits: "Первые депозиты",
  firstDepositAmountAggregation: "Сумма первых депозитов",
  redeposits: "Повторные депозиты",
  currentBalance: "Текущий баланс",
  educationQuality: "Качество обучения",
  acquisitionCohortMode: "Режим когорт привлечения",
  leadDrilldown: "Детализация по пользователям",
  registeredAcquisitionCohort: "Когорта привлечения",
  pocketRegistration: "Регистрация в Pocket",
  firstDeposit: "Первый депозит",
  anonymousVisitorToRegistrationCohortRate: "Конверсия анонимного посетителя в регистрацию",
  unattributedAcquisitionCohort: "Когорта без атрибуции",
  directTrafficCohort: "Когорта прямого трафика",
  maturityScoring: "Оценка зрелости когорты",
  forecasting: "Прогноз",
};

/**
 * The one capability the UI overrides.
 *
 * The backend truthfully reports `leadDrilldown: available` — AFD-5B2B shipped
 * the API. But AFD-5C1 ships no lead surface, so showing a bare "Доступно"
 * would promise a screen that does not exist. The CRM states the API-vs-UI
 * distinction instead of contradicting the backend.
 */
export const LEAD_DRILLDOWN_UI_NOTE =
  "API готов, интерфейс появится в следующей фазе";

/* ------------------------------------------------------------------ errors */

/**
 * Backend `messageKey` → Russian sentence. Closed, with a generic fallback.
 */
export const ANALYTICS_MESSAGE: Record<string, string> = {
  "crm.analytics.preset_invalid": "Неизвестный период",
  "crm.analytics.dates_not_allowed": "Даты можно задавать только для произвольного периода",
  "crm.analytics.custom_range_required": "Укажите начало и конец периода",
  "crm.analytics.date_invalid": "Некорректная дата",
  "crm.analytics.range_reversed": "Начало периода должно быть раньше его конца",
  "crm.analytics.range_too_large": "Период слишком длинный. Используйте «За всё время»",
  "crm.analytics.bucket_cap_exceeded":
    "Слишком много точек на графике для выбранного периода. Выберите более крупную группировку",
  "crm.analytics.group_invalid": "Неизвестная группировка",
  "crm.analytics.dimension_invalid": "Неизвестный разрез",
  "crm.analytics.filter_invalid": "Некорректный фильтр",
  "crm.analytics.filter_hierarchy_mismatch":
    "Кампания или ссылка не принадлежит выбранному аффилейту",
  "crm.analytics.partner_not_found": "Аффилейт не найден",
  "crm.analytics.campaign_not_found": "Кампания не найдена",
  "crm.analytics.tracking_link_not_found": "Ссылка не найдена",
  "crm.analytics.query_unknown": "Некорректные параметры запроса",
  "crm.analytics.query_duplicated": "Параметр запроса указан несколько раз",
  "crm.analytics.limit_invalid": "Некорректный размер страницы",
  "crm.analytics.offset_invalid": "Некорректное смещение страницы",
  "crm.analytics.flag_invalid": "Некорректное значение параметра",
  "crm.analytics.cutoff_invalid": "Некорректная дата отсечки наблюдения",
  "crm.analytics.cutoff_in_future": "Дата отсечки не может быть в будущем",
  "crm.analytics.cutoff_before_cohort_start":
    "Отсечка наблюдения должна быть позже начала когорты",
  "crm.analytics.timezone_invalid": "Ошибка конфигурации отчётов. Обратитесь к администратору",
  "crm.session.unauthenticated": "Сессия истекла. Войдите заново",
  "crm.affiliates.forbidden": "Недостаточно прав для просмотра аналитики",
};

export const GENERIC_FAILURE = "Не удалось загрузить данные. Попробуйте ещё раз";

/** Describe a failed outcome without ever printing a raw key. */
export function describeAnalyticsFailure(outcome: AnalyticsOutcome<unknown>): string {
  switch (outcome.status) {
    case "success":
      return "";
    case "cancelled":
      return "";
    case "unauthenticated":
      return "Сессия истекла. Войдите заново";
    case "forbidden":
      return ANALYTICS_MESSAGE[outcome.messageKey] ?? "Недостаточно прав для просмотра аналитики";
    case "rate_limited":
      return "Слишком много запросов. Повторите через минуту";
    case "upstream_unavailable":
      return "Сервис аналитики недоступен. Попробуйте ещё раз";
    case "malformed_response":
      return "Получен неизвестный формат ответа. Данные не показаны";
    case "misconfigured":
      return ANALYTICS_MESSAGE[outcome.messageKey] ?? GENERIC_FAILURE;
    default:
      return ANALYTICS_MESSAGE[outcome.messageKey] ?? GENERIC_FAILURE;
  }
}

export function failureRequestId(outcome: AnalyticsOutcome<unknown>): string | undefined {
  return "requestId" in outcome ? outcome.requestId : undefined;
}

/* ------------------------------------------------------- explanatory copy */

/**
 * The two mode explanations.
 *
 * The backend also ships its own sentences (`rateModeExplanation`,
 * `cohortModeExplanation`) and the UI renders THOSE where the payload provides
 * them. These are the Russian product copy shown beside the controls, and they
 * are deliberately worded so that neither mode can be read as the other.
 */
export const EVENT_DATE_EXPLANATION =
  "Метрики считают события, произошедшие внутри выбранного периода. Клики, " +
  "регистрации в Академии, регистрации в Pocket и первые депозиты могут " +
  "относиться к разным когортам привлечения.";

export const EVENT_DATE_RATIO_EXPLANATION =
  "Это соотношения событий периода, а не вероятность конверсии клика и не прогноз: " +
  "числитель и знаменатель могут относиться к разным когортам.";

export const COHORT_EXPLANATION =
  "Когорта сформирована по выбранному атрибуционному клику уже " +
  "зарегистрированных пользователей. Прямые регистрации в этот режим не входят, " +
  "а конверсия анонимного посетителя в регистрацию не измеряется.";

export const COHORT_CUTOFF_EXPLANATION =
  "Конверсии учитываются до отсечки наблюдения. События после отсечки исключены, " +
  "поэтому исторический отчёт воспроизводится без заглядывания вперёд.";

export const UNIQUE_VISITOR_NOTE =
  "Уникальные посетители за период считаются один раз по всему периоду и не " +
  "равны сумме значений по столбцам графика.";

/** The backend's interval token, in operator language. */
export const INTERVAL_CONVENTION_LABEL: Record<string, string> = {
  start_inclusive_end_exclusive: "начало включается, конец — нет",
};

export function intervalConventionLabel(value: string): string {
  return INTERVAL_CONVENTION_LABEL[value] ?? value;
}

export const PERIOD_CONTRACT_NOTE =
  "Часовой пояс отчётов: Europe/Moscow. Неделя начинается с понедельника. " +
  "Интервал включает начало и не включает конец.";
