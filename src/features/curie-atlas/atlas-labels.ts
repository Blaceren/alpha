/**
 * AFD-5D2 — Russian copy and presentation mapping for Curie Atlas.
 *
 * EVERY STRING AN OPERATOR READS THAT IS NOT THE BACKEND'S OWN SENTENCE LIVES
 * HERE. The backend renders each finding's message from its closed catalog; this
 * file supplies only the chrome around it — headings, labels for machine-readable
 * enums, and fallbacks for values this release does not recognise.
 *
 * NOTHING HERE CHANGES A FACT. There is no function that rewrites, summarises,
 * softens or embellishes a backend message, and none that derives a finding. The
 * one derived value in this module is a PRESENTATION status, and it is
 * documented at length below because it is the single place this UI adds a
 * concept the DTO does not carry.
 */
import type {
  AtlasCoverage,
  AtlasDimension,
  AtlasEvidenceSource,
  AtlasGroup,
  AtlasMode,
  AtlasReport,
  AtlasSection,
  AtlasSeverity,
} from "@/data/contracts/api/curie-atlas";

/* ------------------------------------------------------------------ identity */

export const ATLAS_TITLE = "Curie Atlas";
export const ATLAS_SUBTITLE = "Детерминированный анализ трафика";

/**
 * The mode badge required by §4.
 *
 * "Без модели" is a statement of fact about this release, backed by
 * `engine.modelInvoked === false` in the very response being displayed — the
 * contract refuses to parse a body that says otherwise. It is deliberately NOT
 * "AI", "ИИ", "нейросеть", "прогноз" or "рекомендации": this engine is a fixed
 * rule set over a closed catalog, and every one of those words would describe
 * something else.
 */
export const ATLAS_MODE_BADGE = "Без модели";
export const ATLAS_ENGINE_NOTE =
  "Детерминированный набор правил по опубликованному каталогу. Модель не вызывается, прогнозы не строятся, причины не выводятся.";

/* ------------------------------------------------------------------ sections */

/** The six section headings, exactly as §7 specifies them. */
export const SECTION_HEADING: Record<AtlasSection, string> = {
  observation: "Наблюдения",
  warning: "Предупреждения",
  positive_signal: "Положительные сигналы",
  question: "Вопросы к данным",
};

export const OVERVIEW_HEADING = "Обзор";
export const SUFFICIENCY_HEADING = "Достаточность данных";

/**
 * Render order.
 *
 * Warnings before observations on purpose: a stored value that needs a human
 * look outranks a description of the period. Positive signals come after both
 * so the screen never opens with reassurance, and questions come last because
 * they describe what the report could NOT establish.
 */
export const SECTION_ORDER: readonly AtlasSection[] = [
  "warning",
  "observation",
  "positive_signal",
  "question",
];

/** Empty-state copy per section. Never "всё хорошо" — absence is not a verdict. */
export const SECTION_EMPTY: Record<AtlasSection, string> = {
  observation: "Наблюдений по этим параметрам нет.",
  warning: "Предупреждений по этим параметрам нет.",
  positive_signal: "Положительных сигналов по этим параметрам нет.",
  question: "Вопросов к данным нет.",
};

/* ------------------------------------------------------------------ severity */

export const SEVERITY_LABEL: Record<AtlasSeverity, string> = {
  info: "Информация",
  attention: "Требует внимания",
};

/**
 * Severity is carried by a LABEL and a SHAPE, never by colour alone (§17).
 *
 * The glyph is decorative and is hidden from assistive technology; the adjacent
 * text label is what a screen reader announces.
 */
export const SEVERITY_GLYPH: Record<AtlasSeverity, string> = {
  info: "•",
  attention: "!",
};

/* --------------------------------------------------------------- vocabulary */

export const MODE_LABEL: Record<AtlasMode, string> = {
  event_date: "По дате события",
  acquisition_cohort: "Когорты привлечения",
};

export const GROUP_LABEL: Record<AtlasGroup, string> = {
  day: "День",
  week: "Неделя",
  month: "Месяц",
};

export const DIMENSION_LABEL: Record<AtlasDimension, string> = {
  affiliate: "Аффилейт",
  campaign: "Кампания",
  tracking_link: "Трекинговая ссылка",
};

export const COVERAGE_LABEL: Record<AtlasCoverage, string> = {
  attributed: "С атрибуцией",
  unattributed: "Без атрибуции",
  total: "Всего",
};

/** Which accepted aggregate an evidence operand came from. */
export const EVIDENCE_SOURCE_LABEL: Record<AtlasEvidenceSource, string> = {
  summary: "Сводка",
  timeseries: "Временной ряд",
  breakdown: "Разбивка",
  availability: "Доступность данных",
  integrity: "Целостность данных",
  period: "Период",
};

/**
 * Labels for the headline metric keys this backend release publishes.
 *
 * An UNKNOWN key is shown under its own raw key rather than dropped: a metric
 * the backend added is still a number the operator should see, and hiding it
 * would be a silent omission. `headlineMetricLabel` implements that.
 */
export const HEADLINE_METRIC_LABEL: Record<string, string> = {
  qualifiedClicks: "Засчитанные клики",
  academyRegistrations: "Регистрации в Академии",
  pocketRegistrations: "Регистрации в Pocket",
  confirmedFirstDeposits: "Подтверждённые первые депозиты",
  pendingIdentityDeposits: "Депозиты без сопоставления",
  conflictingDeposits: "Конфликтующие депозиты",
  cohortLearners: "Учеников в когорте",
  pocketRegisteredLearners: "Из них зарегистрированы в Pocket",
  firstDepositLearners: "Из них с первым депозитом",
};

export function headlineMetricLabel(key: string): string {
  return HEADLINE_METRIC_LABEL[key] ?? key;
}

/* ------------------------------------------------------- insufficiency reasons */

/**
 * Russian labels for the reason codes.
 *
 * The first two are what backend candidate `4511acf8` actually emits. The rest
 * are named by the AFD-5D2 brief and are carried so that a later backend release
 * emitting one renders a reviewed sentence rather than the fallback.
 *
 * AN UNKNOWN CODE IS NOT AN ERROR. §12 requires a safe generic fallback, because
 * a new backend reason must not blank a page — see `insufficiencyReasonLabel`.
 */
export const INSUFFICIENCY_REASON_LABEL: Record<string, string> = {
  no_events_in_period: "За выбранный период нет событий.",
  empty_cohort: "В выбранной когорте нет учеников.",
  SAMPLE_TOO_SMALL: "Выборка слишком мала для расчёта.",
  COHORT_FOLLOWUP_INCOMPLETE: "Период наблюдения когорты ещё не завершён.",
  MIXED_CURRENCY: "В периоде несколько валют, суммы не агрегируются.",
  COMPARISON_PERIOD_UNAVAILABLE: "Период для сравнения недоступен.",
  BREAKDOWN_TRUNCATED: "Разбивка усечена: показаны не все элементы.",
};

/** The fallback. Factual, and it never guesses what the unknown code meant. */
export const INSUFFICIENCY_REASON_FALLBACK =
  "Бэкенд вернул причину, которую эта версия интерфейса не знает. Код указан в технических деталях.";

export function insufficiencyReasonLabel(reason: string): string {
  return INSUFFICIENCY_REASON_LABEL[reason] ?? INSUFFICIENCY_REASON_FALLBACK;
}

export function isKnownInsufficiencyReason(reason: string): boolean {
  return Object.prototype.hasOwnProperty.call(INSUFFICIENCY_REASON_LABEL, reason);
}

/**
 * Whether a neutral "adjust the period or filters" hint is warranted.
 *
 * §12: offer it ONLY when the returned reason directly supports it. An empty
 * period and an empty cohort are both answered by widening the selection; a
 * mixed-currency period is not, and telling an operator to widen it would be
 * advice that cannot work. An unknown code gets no hint at all.
 */
const REASONS_ANSWERED_BY_WIDENING = new Set([
  "no_events_in_period",
  "empty_cohort",
  "SAMPLE_TOO_SMALL",
]);

export function adjustmentHintFor(reason: string): string | null {
  return REASONS_ANSWERED_BY_WIDENING.has(reason)
    ? "Попробуйте расширить период или снять часть фильтров."
    : null;
}

/* ------------------------------------------------------ presentation status */

/**
 * THE ONE DERIVED CONCEPT IN THIS UI, and the reason it exists.
 *
 * §12 of the brief describes three result states — `ok`, `partial`,
 * `insufficient_data`. The backend DTO carries only TWO: `dataSufficiency.status`
 * is `sufficient | insufficient_data`. There is no `partial` in the contract,
 * and inventing a backend status would be exactly the reinterpretation §3
 * forbids.
 *
 * So `partial` is derived HERE, for PRESENTATION ONLY, and only from facts the
 * backend itself stated:
 *
 *   - the status is `sufficient`, AND
 *   - at least one returned finding cites evidence whose source is
 *     `availability` or `integrity`.
 *
 * Those two evidence sources are the backend's own way of saying "a capability
 * was unavailable" or "a stored value disagrees with another stored value". A
 * report carrying one is complete as far as it goes and incomplete in a way the
 * operator must see — which is precisely what §12's `partial` describes.
 *
 * WHAT THIS FUNCTION NEVER DOES: it never contradicts the backend. It cannot
 * turn `insufficient_data` into `ok`, it cannot turn `sufficient` into
 * `insufficient_data`, and it adds no finding. The raw backend status is
 * displayed beside the derived one, labelled as the backend's, so an operator
 * can always see which is which.
 */
export type AtlasResultStatus = "ok" | "partial" | "insufficient_data";

export const AVAILABILITY_EVIDENCE_SOURCES: readonly AtlasEvidenceSource[] = [
  "availability",
  "integrity",
];

export function deriveResultStatus(report: AtlasReport): AtlasResultStatus {
  if (report.dataSufficiency.status === "insufficient_data") return "insufficient_data";

  const limited = [
    ...report.warnings,
    ...report.observations,
    ...report.positiveSignals,
    ...report.questions,
  ].some((finding) =>
    finding.evidence.some((item) =>
      (AVAILABILITY_EVIDENCE_SOURCES as readonly string[]).includes(item.source),
    ),
  );

  return limited ? "partial" : "ok";
}

export const RESULT_STATUS_LABEL: Record<AtlasResultStatus, string> = {
  ok: "Данных достаточно",
  partial: "Данных достаточно, с ограничениями",
  insufficient_data: "Недостаточно данных",
};

export const RESULT_STATUS_NOTE: Record<AtlasResultStatus, string> = {
  ok: "Бэкенд подтвердил достаточность данных для выбранных параметров.",
  partial:
    "Бэкенд подтвердил достаточность данных, но часть показателей помечена как недоступная или несогласованная. Отчёт неполон — смотрите предупреждения.",
  insufficient_data:
    "Бэкенд сообщил, что данных для выбранных параметров недостаточно. Разделы с наблюдениями не заполняются.",
};

/** The backend's own word, shown beside the derived status so both are visible. */
export const BACKEND_SUFFICIENCY_LABEL: Record<string, string> = {
  sufficient: "sufficient",
  insufficient_data: "insufficient_data",
};

/* ---------------------------------------------------------------- entity labels */

/**
 * The bounded neutral label for a dimension member whose name could not be
 * resolved (§11).
 *
 * It NEVER fabricates a name and never prints the raw numeric id as if it were
 * one. The id remains available in technical details, where it is a stable scope
 * reference rather than an identity.
 */
export function unresolvedDimensionLabel(dimension: AtlasDimension): string {
  return `${DIMENSION_LABEL[dimension]} без названия`;
}

/* ---------------------------------------------------------------- failures */

/**
 * Operator-facing text for every failure outcome.
 *
 * `messageKey` is never printed. An unrecognised key falls back to the generic
 * sentence, because a backend key is an internal identifier and not copy.
 */
export const ATLAS_MESSAGE: Record<string, string> = {
  "crm.analysis.body_unknown_key": "Интерфейс отправил параметр, который бэкенд не принимает.",
  "crm.analysis.body_too_large": "Запрос слишком большой.",
  "crm.analysis.body_invalid": "Бэкенд не смог разобрать запрос.",
  "crm.analysis.mode_invalid": "Неизвестный режим анализа.",
  "crm.analysis.cutoff_not_allowed": "Отсечка доступна только в режиме когорт.",
  "crm.analytics.preset_invalid": "Неизвестный период.",
  "crm.analytics.dates_not_allowed": "Даты можно задавать только с произвольным периодом.",
  "crm.analytics.group_invalid": "Неизвестная группировка.",
  "crm.analytics.dimension_invalid": "Неизвестный разрез.",
  "crm.affiliates.forbidden": "Недостаточно прав для просмотра аналитики аффилейтов.",
};

export const ATLAS_GENERIC_FAILURE = "Не удалось выполнить анализ. Попробуйте ещё раз.";

export const CONTRACT_VIOLATION_MESSAGE: Record<string, string> = {
  model_invoked:
    "Ответ помечен как полученный с участием модели. Эта версия интерфейса отображает только детерминированные отчёты и такой ответ не показывает.",
  legacy_opportunities_field:
    "Ответ содержит устаревшее поле opportunities. Эта версия интерфейса работает с полем positiveSignals.",
  unexpected_agent:
    "Ответ получен от другого агента или другой версии контракта, чем та, с которой проверялся этот интерфейс.",
  schema_mismatch:
    "Ответ не соответствует опубликованному контракту Curie Atlas и не отображается.",
};

export const STALE_NOTICE = "Параметры изменились. Запустите анализ повторно.";
export const RUN_ACTION = "Запустить анализ";
export const RUN_ACTION_BUSY = "Выполняется анализ…";
export const EVIDENCE_DISCLOSURE = "Показать данные";
export const TECHNICAL_DETAILS = "Технические детали";
