/**
 * AFD-5D1 — the closed catalog: the ONLY place a sentence can come from.
 *
 * Each entry binds a `FindingCode` to its section, its severity, the operands it
 * requires, and a template that turns those operands into one Russian sentence.
 * A rule supplies operands; it cannot supply prose. A model added later over the
 * same catalog would supply a code and operands too — so the set of sentences
 * this product can ever emit is the set below, reviewable on one screen.
 *
 * THE HOUSE STYLE, AND WHY EACH RULE EXISTS:
 *
 *   • STATE THE MEASUREMENT, NOT ITS MEANING. "Конверсия Pocket снизилась с 42 %
 *     до 35 %" is a fact about two published numbers. "Вероятно, проблема в
 *     лендинге" is a story about a number, and no stored row supports it.
 *   • NO CAUSAL CONNECTIVES. No «из-за», «потому что», «связано с», «привело к».
 *     A change and its reason are different claims and this report holds only
 *     the first.
 *   • NO FUTURE TENSE AND NO EXPECTATION. No «ожидается», «прогноз», «будет».
 *   • NO IMPERATIVES AND NO ADVICE. No «рекомендуем», «следует», «стоит»,
 *     «отключить», «увеличить ставку», nothing about CPA or payouts.
 *   • NO QUALITY WORDS. Traffic is never «плохой», «хороший», «некачественный»;
 *     a member's rate «отличается», it is not «слабое».
 *   • ABSENCE IS NAMED, NEVER ZEROED. A rate with an empty denominator is
 *     "не определена", not "0 %".
 *
 * `analysis-catalog.test` renders every entry with sample operands and fails if
 * any sentence contains a word from the forbidden lexicon, so the style above is
 * checked rather than trusted.
 */
import {
  ANALYSIS_CATALOG_VERSION,
  type AnalysisSection,
  type FindingCode,
  type FindingSeverity,
} from "./analysis-contract";

export { ANALYSIS_CATALOG_VERSION };

/** Operands are always strings; the catalog never does arithmetic. */
export type Operands = Readonly<Record<string, string>>;

export type CatalogEntry = {
  readonly section: AnalysisSection;
  readonly severity: FindingSeverity;
  /** Every key the template reads. A missing one is an error, never a blank. */
  readonly requiredOperands: readonly string[];
  readonly render: (operands: Operands) => string;
};

/** Read an operand, refusing to render a sentence with a hole in it. */
function need(operands: Operands, key: string): string {
  const value = operands[key];
  if (value === undefined || value === "") {
    throw new Error(`analysis catalog: missing operand "${key}"`);
  }
  return value;
}

/* ---------------------------------------------------------------- labels */

/** Metric names as an operator reads them. Closed: an unknown key stays raw. */
export const METRIC_LABEL: Readonly<Record<string, string>> = {
  rawClicks: "Все клики",
  qualifiedClicks: "Квалифицированные клики",
  prefetchClicks: "Prefetch-клики",
  authenticatedUserClicks: "Клики авторизованных пользователей",
  uniqueVisitors: "Уникальные посетители",
  academyRegistrations: "Регистрации в Академии",
  pocketRegistrations: "Регистрации в Pocket",
  confirmedFirstDeposits: "Подтверждённые первые депозиты",
  pendingIdentityDeposits: "Депозиты в ожидании подтверждения личности",
  conflictingDeposits: "Депозиты с конфликтом",
  cohortLearners: "Учащиеся в когорте",
  pocketRegisteredLearners: "Учащиеся с регистрацией в Pocket",
  firstDepositLearners: "Учащиеся с первым депозитом",
};

export function metricLabel(key: string): string {
  return METRIC_LABEL[key] ?? key;
}

/** Ratio names, each stating the pair it relates. Never abbreviated to a slogan. */
export const RATE_LABEL: Readonly<Record<string, string>> = {
  qualifiedClickToAcademyRegistrationRate: "Клик → регистрация в Академии",
  academyRegistrationToPocketRegistrationRate: "Регистрация в Академии → регистрация в Pocket",
  pocketRegistrationToFirstDepositRate: "Регистрация в Pocket → первый депозит",
  qualifiedClickToPocketRegistrationRate: "Клик → регистрация в Pocket",
  qualifiedClickToFirstDepositRate: "Клик → первый депозит",
  pocketRegistrationRate: "Доля учащихся с регистрацией в Pocket",
  firstDepositRate: "Доля учащихся с первым депозитом",
  pocketToFirstDepositRate: "Регистрация в Pocket → первый депозит",
};

export function rateLabel(key: string): string {
  return RATE_LABEL[key] ?? key;
}

export const LAG_LABEL: Readonly<Record<string, string>> = {
  selectedClickToAcademyRegistration: "От выбранного клика до регистрации в Академии",
  academyRegistrationToPocketRegistration: "От регистрации в Академии до регистрации в Pocket",
  pocketRegistrationToFirstDeposit: "От регистрации в Pocket до первого депозита",
  selectedClickToFirstDeposit: "От выбранного клика до первого депозита",
};

export function lagLabel(key: string): string {
  return LAG_LABEL[key] ?? key;
}

/** A dimension member is named by its id: this report resolves no display names. */
export const DIMENSION_LABEL: Readonly<Record<string, string>> = {
  affiliate: "Аффилейт",
  campaign: "Кампания",
  tracking_link: "Ссылка",
};

export function memberLabel(dimension: string, dimensionId: string): string {
  return `${DIMENSION_LABEL[dimension] ?? dimension} #${dimensionId}`;
}

/** Reasons an amount total cannot be published, in the aggregate's own words. */
const AMOUNT_REASON: Readonly<Record<string, string>> = {
  currency_unspecified_or_mixed:
    "валюта не указана или в периоде встречается несколько валют",
  no_confirmed_first_deposits: "подтверждённых первых депозитов нет",
};

/* --------------------------------------------------------------- catalog */

export const ANALYSIS_CATALOG: Readonly<Record<FindingCode, CatalogEntry>> = {
  /* ------------------------------------------------- observations: levels */

  period_volume: {
    section: "observation",
    severity: "info",
    requiredOperands: ["metric", "value"],
    render: (o) => `${metricLabel(need(o, "metric"))}: ${need(o, "value")}.`,
  },

  funnel_rate_level: {
    section: "observation",
    severity: "info",
    requiredOperands: ["rate", "percent", "numerator", "denominator", "denominatorMetric"],
    render: (o) =>
      `${rateLabel(need(o, "rate"))}: ${need(o, "percent")} % ` +
      `(${need(o, "numerator")} из ${need(o, "denominator")}, ` +
      `знаменатель — ${metricLabel(need(o, "denominatorMetric"))}).`,
  },

  funnel_rate_undefined: {
    section: "observation",
    severity: "info",
    requiredOperands: ["rate", "denominatorMetric"],
    render: (o) =>
      `${rateLabel(need(o, "rate"))}: не определена — ` +
      `${metricLabel(need(o, "denominatorMetric"))} равны нулю. Это не ноль процентов.`,
  },

  coverage_split: {
    section: "observation",
    severity: "info",
    requiredOperands: ["metric", "attributed", "unattributed", "total", "attributedPercent"],
    render: (o) =>
      `${metricLabel(need(o, "metric"))}: с привлечением ${need(o, "attributed")}, ` +
      `прямых ${need(o, "unattributed")}, всего ${need(o, "total")} ` +
      `(доля с привлечением ${need(o, "attributedPercent")} %).`,
  },

  cohort_size: {
    section: "observation",
    severity: "info",
    requiredOperands: ["value"],
    render: (o) => `Размер когорты: ${need(o, "value")} учащихся.`,
  },

  cohort_rate_level: {
    section: "observation",
    severity: "info",
    requiredOperands: ["rate", "percent", "numerator", "denominator", "denominatorMetric"],
    render: (o) =>
      `${rateLabel(need(o, "rate"))}: ${need(o, "percent")} % ` +
      `(${need(o, "numerator")} из ${need(o, "denominator")}, ` +
      `знаменатель — ${metricLabel(need(o, "denominatorMetric"))}).`,
  },

  cohort_rate_undefined: {
    section: "observation",
    severity: "info",
    requiredOperands: ["rate", "denominatorMetric"],
    render: (o) =>
      `${rateLabel(need(o, "rate"))}: не определена — ` +
      `${metricLabel(need(o, "denominatorMetric"))} равны нулю. Это не ноль процентов.`,
  },

  cohort_median_lag: {
    section: "observation",
    severity: "info",
    requiredOperands: ["lag", "seconds", "sampleSize"],
    render: (o) =>
      `${lagLabel(need(o, "lag"))}: медиана ${need(o, "seconds")} с ` +
      `(наблюдений: ${need(o, "sampleSize")}).`,
  },

  cohort_median_unavailable: {
    section: "observation",
    severity: "info",
    requiredOperands: ["lag"],
    render: (o) => `${lagLabel(need(o, "lag"))}: наблюдений нет, медиана не рассчитана.`,
  },

  /* ------------------------------------------------ observations: change */

  series_count_change: {
    section: "observation",
    severity: "info",
    requiredOperands: [
      "metric",
      "direction",
      "firstLabel",
      "firstValue",
      "lastLabel",
      "lastValue",
      "changePercent",
    ],
    render: (o) =>
      `${metricLabel(need(o, "metric"))} ` +
      `${need(o, "direction") === "up" ? "выросли" : "снизились"} ` +
      `с ${need(o, "firstValue")} (${need(o, "firstLabel")}) ` +
      `до ${need(o, "lastValue")} (${need(o, "lastLabel")}), ` +
      `изменение ${need(o, "changePercent")} %.`,
  },

  series_rate_change: {
    section: "observation",
    severity: "info",
    requiredOperands: [
      "rate",
      "direction",
      "firstLabel",
      "firstPercent",
      "lastLabel",
      "lastPercent",
      "changePoints",
    ],
    render: (o) =>
      `${rateLabel(need(o, "rate"))} ` +
      `${need(o, "direction") === "up" ? "выросла" : "снизилась"} ` +
      `с ${need(o, "firstPercent")} % (${need(o, "firstLabel")}) ` +
      `до ${need(o, "lastPercent")} % (${need(o, "lastLabel")}), ` +
      `изменение ${need(o, "changePoints")} п.п.`,
  },

  series_flat: {
    section: "observation",
    severity: "info",
    requiredOperands: ["metric", "firstLabel", "lastLabel", "thresholdPercent"],
    render: (o) =>
      `${metricLabel(need(o, "metric"))}: изменение между ${need(o, "firstLabel")} ` +
      `и ${need(o, "lastLabel")} меньше порога отчёта ` +
      `(${need(o, "thresholdPercent")} %).`,
  },

  /* ------------------------------------------- observations: composition */

  breakdown_member_count: {
    section: "observation",
    severity: "info",
    requiredOperands: ["dimension", "value"],
    render: (o) =>
      `В разбивке «${DIMENSION_LABEL[need(o, "dimension")] ?? need(o, "dimension")}» ` +
      `участников с активностью: ${need(o, "value")}.`,
  },

  breakdown_concentration: {
    section: "observation",
    severity: "info",
    requiredOperands: ["dimension", "dimensionId", "metric", "value", "total", "sharePercent"],
    render: (o) =>
      `${memberLabel(need(o, "dimension"), need(o, "dimensionId"))}: ` +
      `${metricLabel(need(o, "metric"))} ${need(o, "value")} из ${need(o, "total")} ` +
      `по разбивке — ${need(o, "sharePercent")} %.`,
  },

  /* ------------------------------------------------------------ warnings */

  conflicting_deposits_present: {
    section: "warning",
    severity: "attention",
    requiredOperands: ["value"],
    render: (o) =>
      `Депозиты с конфликтом в периоде: ${need(o, "value")}. ` +
      `Это состояние записи провайдера; учтённые депозиты оно не отменяет.`,
  },

  pending_identity_deposits_present: {
    section: "warning",
    severity: "attention",
    requiredOperands: ["value"],
    render: (o) =>
      `Депозиты в ожидании подтверждения личности: ${need(o, "value")}. ` +
      `Подтверждённым первым депозитом такой депозит не считается.`,
  },

  amount_aggregation_unavailable: {
    section: "warning",
    severity: "info",
    requiredOperands: ["reason"],
    render: (o) =>
      `Сумма первых депозитов не публикуется: ` +
      `${AMOUNT_REASON[need(o, "reason")] ?? need(o, "reason")}.`,
  },

  series_reconciliation_mismatch: {
    section: "warning",
    severity: "attention",
    requiredOperands: ["metric", "bucketSum", "periodTotal"],
    render: (o) =>
      `${metricLabel(need(o, "metric"))}: сумма по столбцам ${need(o, "bucketSum")} ` +
      `не совпадает с итогом за период ${need(o, "periodTotal")}.`,
  },

  small_sample_rate: {
    section: "warning",
    severity: "info",
    requiredOperands: ["rate", "denominator", "threshold"],
    render: (o) =>
      `${rateLabel(need(o, "rate"))} рассчитана на знаменателе ${need(o, "denominator")}, ` +
      `что меньше порога отчёта ${need(o, "threshold")}.`,
  },

  negative_duration_observed: {
    section: "warning",
    severity: "attention",
    requiredOperands: ["lag", "value"],
    render: (o) =>
      `${lagLabel(need(o, "lag"))}: записей с отрицательной длительностью ` +
      `${need(o, "value")}. Они исключены из медианы.`,
  },

  cohort_missing_or_duplicate_registration: {
    section: "warning",
    severity: "attention",
    requiredOperands: ["value"],
    render: (o) =>
      `Учащихся без единственного события регистрации в Академии: ${need(o, "value")}. ` +
      `Они исключены из метрик когорты.`,
  },

  cohort_duplicate_first_deposit: {
    section: "warning",
    severity: "attention",
    requiredOperands: ["value"],
    render: (o) =>
      `Учащихся с более чем одним подтверждённым первым депозитом: ${need(o, "value")}.`,
  },

  cohort_cutoff_clamped: {
    section: "warning",
    severity: "info",
    requiredOperands: ["cutoff"],
    render: (o) =>
      `Отсечка наблюдения ограничена часами отчёта: ${need(o, "cutoff")}. ` +
      `Значения за пределами отсечки в отчёт не входят.`,
  },

  /* ----------------------------------------------------- positive signals */

  member_clicks_without_registrations: {
    section: "positive_signal",
    severity: "info",
    requiredOperands: ["dimension", "dimensionId", "clicks"],
    render: (o) =>
      `${memberLabel(need(o, "dimension"), need(o, "dimensionId"))}: ` +
      `квалифицированных кликов ${need(o, "clicks")}, регистраций в Академии — ноль.`,
  },

  member_registrations_without_deposits: {
    section: "positive_signal",
    severity: "info",
    requiredOperands: ["dimension", "dimensionId", "pocketRegistrations"],
    render: (o) =>
      `${memberLabel(need(o, "dimension"), need(o, "dimensionId"))}: ` +
      `регистраций в Pocket ${need(o, "pocketRegistrations")}, ` +
      `подтверждённых первых депозитов — ноль.`,
  },

  member_rate_differs_from_aggregate: {
    section: "positive_signal",
    severity: "info",
    requiredOperands: [
      "dimension",
      "dimensionId",
      "rate",
      "memberPercent",
      "aggregatePercent",
      "differencePoints",
      "direction",
    ],
    render: (o) =>
      `${memberLabel(need(o, "dimension"), need(o, "dimensionId"))}: ` +
      `${rateLabel(need(o, "rate"))} ${need(o, "memberPercent")} % ` +
      `против ${need(o, "aggregatePercent")} % по разбивке — ` +
      `${need(o, "direction") === "up" ? "выше" : "ниже"} на ` +
      `${need(o, "differencePoints")} п.п.`,
  },

  /* ------------------------------------------------------------ questions */

  question_cause_not_available: {
    section: "question",
    severity: "info",
    requiredOperands: [],
    render: () =>
      `Почему значения изменились — отчёт не отвечает: ` +
      `в исходных данных нет сведений о причинах.`,
  },

  question_forecast_not_available: {
    section: "question",
    severity: "info",
    requiredOperands: [],
    render: () =>
      `Какими значения станут дальше — отчёт не отвечает: ` +
      `он описывает только зафиксированные периоды.`,
  },

  question_traffic_quality_not_available: {
    section: "question",
    severity: "info",
    requiredOperands: [],
    render: () =>
      `Каково качество трафика — отчёт не отвечает: ` +
      `такой показатель не собирается и не рассчитывается.`,
  },

  question_redeposits_unavailable: {
    section: "question",
    severity: "info",
    requiredOperands: [],
    render: () =>
      `Сколько было повторных депозитов — отчёт не отвечает: ` +
      `провайдер не передаёт идентификатор транзакции, поэтому повторный депозит ` +
      `неотличим от повторной доставки первого.`,
  },

  question_current_balance_unavailable: {
    section: "question",
    severity: "info",
    requiredOperands: [],
    render: () =>
      `Каковы текущие балансы — отчёт не отвечает: ` +
      `официального API баланса нет, показатель не собирается.`,
  },

  question_education_timeline_unavailable: {
    section: "question",
    severity: "info",
    requiredOperands: [],
    render: () =>
      `Что происходило в обучении — отчёт не отвечает: ` +
      `достоверных продуктовых событий обучения пока не существует.`,
  },

  /* -------------------------------------------------------- insufficiency */

  insufficient_data: {
    section: "warning",
    severity: "attention",
    requiredOperands: ["reason"],
    render: (o) =>
      need(o, "reason") === "empty_cohort"
        ? `insufficient_data: в выбранном интервале привлечения нет ни одного учащегося. ` +
          `Наблюдения и сопоставления не приводятся.`
        : `insufficient_data: в выбранном периоде нет ни одного события. ` +
          `Наблюдения и сопоставления не приводятся.`,
  },
};

/** Every code the catalog knows, for exhaustiveness tests. */
export const CATALOG_CODES = Object.keys(ANALYSIS_CATALOG) as FindingCode[];
