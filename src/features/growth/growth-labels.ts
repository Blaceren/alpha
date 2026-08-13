/**
 * G4-GROWTH — the words the Growth workspace uses, in one place.
 *
 * WHY THE LABELS MATTER MORE THAN USUAL HERE. This workspace shows four
 * Pocket-shaped numbers that a reader will conflate unless the interface refuses
 * to let them: a Pocket registration is not a deposit, a first deposit is not a
 * redeposit, and an unresolved redeposit is not a redeposit that did not happen.
 * §5 forbids blurring those four, and a label is where the blurring starts.
 */

export const INSUFFICIENT_DATA = "Недостаточно данных";

/** Render an exact decimal ratio string as a percentage. Null is NOT zero. */
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

export function isRatioUnavailable(value: string | null): boolean {
  return value === null;
}

/** Thin space separators, so 12345 reads as 12 345. */
export function formatCount(value: number): string {
  return value.toLocaleString("ru-RU").replace(/ /g, " ");
}

/**
 * Money, with its currency, or an explicit statement of why it cannot be shown.
 *
 * NEVER RENDERS A BARE NUMBER. An amount with no unit is not a smaller truth
 * than an amount with one — it is a different kind of statement, and showing
 * "1 250" beside a currency-less deposit set would invite the reader to supply a
 * unit themselves.
 */
export function formatAmount(amount: string | null, currencyCode: string | null): string {
  if (amount === null) return INSUFFICIENT_DATA;
  if (currencyCode === null) return `${amount} (валюта не указана провайдером)`;
  return `${amount} ${currencyCode}`;
}

export const AMOUNT_UNAVAILABLE_REASON: Record<string, string> = {
  no_deposits_in_period: "За период не было депозитов",
  currency_unspecified: "Провайдер не сообщил валюту — суммы не складываются",
  currency_mixed: "В выборке несколько валют — суммы не складываются",
  amount_unreadable: "Часть сумм не читается в каноническом виде",
  not_requested_on_this_surface: "Не запрашивается на этом экране",
  per_row_amounts_not_published_on_this_surface: "Суммы по строкам здесь не публикуются",
};

export function amountUnavailableReason(reason: string): string {
  return AMOUNT_UNAVAILABLE_REASON[reason] ?? reason;
}

export const AVAILABILITY_REASON: Record<string, string> = {
  provider_event_identity_contract_absent:
    "Pocket не передаёт уникальный идентификатор события, поэтому повтор доставки " +
    "неотличим от нового депозита. Это НЕ ноль редепозитов.",
  historical_submission_instant_not_owned:
    "Момент отправки на проверку не сохранялся для уже одобренных уровней. " +
    "Новые отправки фиксируются точно.",
  prohibited_not_collected: "Платформа не собирает текущий баланс",
  dimension_not_captured: "Разрез не собирается — креатив, angle и вариант лендинга не хранятся",
  not_in_scope_for_growth_v1: "Вне объёма текущей фазы",
  currency_unspecified: "Валюта не указана провайдером",
  currency_mixed: "В выборке несколько валют",
  currency_unspecified_or_mixed: "Валюта не указана или в выборке их несколько",
};

/**
 * G4-R13 — one lookup for every reason the availability block can carry.
 *
 * WHAT WAS WRONG. `dataAvailability.firstDepositAmountAggregation` carries the
 * AMOUNT reasons — `no_deposits_in_period`, `not_requested_on_this_surface`,
 * `per_row_amounts_not_published_on_this_surface`, `amount_unreadable` — while
 * this function looked only in `AVAILABILITY_REASON`. Every one of them fell
 * through to `?? reason` and the «Что платформа не измеряет» block printed a raw
 * snake_case enum to the operator. The Russian already existed, twenty lines
 * above, in `AMOUNT_UNAVAILABLE_REASON`.
 *
 * Both maps are consulted, in that order, because the two vocabularies overlap
 * on `currency_*` and this map's wording is the one written for this block.
 *
 * THE RAW CODE IS STILL THE LAST RESORT, deliberately. A reason the backend
 * introduces and the CRM has not learned yet must render as SOMETHING an
 * operator can quote into a bug report — an empty string or a generic "не
 * измеряется" would hide the very fact this block exists to state. The contract
 * test beside this file is what keeps that path unreachable in practice.
 */
export function availabilityReason(reason: string): string {
  return AVAILABILITY_REASON[reason] ?? AMOUNT_UNAVAILABLE_REASON[reason] ?? reason;
}

/**
 * G4-R12 — the sentence that tells the dashboard's reader what «Регистрации
 * ATA» actually counts, before they read the number.
 *
 * WHY IT IS NEEDED. The figure is exact and canonical: accounts holding a
 * provable self-service registration record. It is not the number of accounts
 * on the platform. That is why «Активированы 14» can sit beside «Регистрации
 * ATA 12» — some activated learners registered before, or outside, the audited
 * registration path — and without this sentence that reads as a data error.
 *
 * IT INVENTS NOTHING. The unprovable population is split only into what a staff
 * profile explains and what nothing explains, and the second group is named
 * «исторические» rather than being assigned an origin. Uncertainty stays
 * uncertainty; §12 of the closure brief and §49 of the migration both require
 * exactly that.
 *
 * PRODUCT WORDING, NOT AUDIT JARGON: no finding ids, no field names.
 */
export function registrationScopeHint(scope: {
  provable: number;
  population: number;
  unprovableStaff: number;
  unprovableOther: number;
}): string | undefined {
  const unprovable = scope.population - scope.provable;
  if (unprovable <= 0) return undefined;

  const parts: string[] = [];
  if (scope.unprovableStaff > 0) parts.push(`${scope.unprovableStaff} — сотрудники`);
  if (scope.unprovableOther > 0) parts.push(`${scope.unprovableOther} — исторические`);

  const breakdown = parts.length > 0 ? `: ${parts.join(", ")}` : "";
  return (
    `${scope.provable} регистраций с подтверждённым источником. ` +
    `Всего аккаунтов — ${scope.population}; у ещё ${unprovable} происхождение ` +
    `не восстанавливается${breakdown}.`
  );
}

export const CAPABILITY_LABEL: Record<string, string> = {
  trafficClicks: "Клики",
  ataRegistrations: "Регистрации ATA",
  enrollments: "Зачисления",
  academyActivation: "Активация",
  educationProgression: "Прогресс обучения",
  mentorReviewSubmissions: "Отправки на проверку ментору",
  pocketRegistrations: "Регистрации Pocket",
  firstDeposits: "Первые депозиты",
  firstDepositAmountAggregation: "Суммы первых депозитов",
  redeposits: "Редепозиты",
  currentBalance: "Текущий баланс",
  acquisitionCreativeDimensions: "Разрезы по креативам",
  cpaAndCommission: "CPA и комиссии",
};

export const FUNNEL_STEP_LABEL: Record<string, string> = {
  click: "Клик",
  ata_registration: "Регистрация ATA",
  enrollment: "Зачисление",
  academy_activation: "Активация",
  pocket_registration: "Регистрация Pocket",
  first_deposit: "Первый депозит",
};

export const DIMENSION_LABEL: Record<string, string> = {
  affiliatePartner: "Партнёр",
  affiliateCampaign: "Кампания",
  trackingLink: "Ссылка",
};

export const INGRESS_STATUS_LABEL: Record<string, string> = {
  accepted: "Принято",
  duplicates: "Повторные доставки",
  pendingLinkage: "Ожидают связывания",
  identityUnresolved: "Идентичность не определена",
  rejected: "Отклонено",
  quarantined: "В карантине",
  authRejected: "Отказ аутентификации",
  schemaRejected: "Неверная схема",
  unknownGoal: "Неизвестный goal",
  disabledGoal: "Отключённый goal",
  unlinkedClick: "Неизвестный clickid",
  playerConflict: "Конфликт игрока",
  orderingUnresolved: "Нарушен порядок событий",
};

export const PRESET_LABEL: Record<string, string> = {
  today: "Сегодня",
  yesterday: "Вчера",
  current_week: "Текущая неделя",
  previous_week: "Прошлая неделя",
  last_7_days: "7 дней",
  last_30_days: "30 дней",
  current_month: "Текущий месяц",
  previous_month: "Прошлый месяц",
  all_time: "За всё время",
};

export const PRESET_ORDER = [
  "today",
  "yesterday",
  "last_7_days",
  "last_30_days",
  "current_month",
  "previous_month",
  "all_time",
] as const;
