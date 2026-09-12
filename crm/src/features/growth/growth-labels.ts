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

  // G4-R13-B. The redeposit identity policy's OTHER reason. It reaches the
  // operator through the ingress-health surface, and it became more reachable
  // when a mixed-case `POCKET_RDEP_EVENT_ID_PARAM` started being refused loudly
  // instead of silently lower-cased — so the label has to exist before anyone
  // configures one.
  configured_param_rejected:
    "Указанное имя параметра отклонено политикой. Идентичность редепозита не " +
    "устанавливается, пока имя не будет исправлено.",
};

/**
 * G4-R13-B — the redeposit identity CONTRACT state, as an operator sentence.
 *
 * WHAT WENT WRONG. «Здоровье приёма» printed the domain enum and its reason
 * verbatim: «Контракт идентичности редепозита: unavailable —
 * provider_event_identity_contract_absent.» Both are internal machine values,
 * and a human label for the reason already existed and rendered correctly on
 * the four other surfaces. The first G4-R13 correction fixed
 * `availabilityReason()`'s lookup and the `AvailabilityList` component; this
 * render site reaches the same vocabulary by a different route and was missed.
 *
 * WHY IT IS A MAP AND NOT AN INLINE TERNARY. The API contract types this field
 * as an open string, so a state this build has not learned must still render as
 * something an operator can quote — the same last-resort rule
 * `availabilityReason()` follows.
 *
 * THE WORDING IS FAIL-CLOSED, DELIBERATELY. `unavailable` is not a UI outage
 * and not a temporary condition: no provider event-identity contract has been
 * established, so canonical redeposit processing cannot run and does not.
 * Copy that read «временно недоступно» would imply this resolves itself.
 */
export const REDEPOSIT_IDENTITY_CONTRACT: Record<string, string> = {
  unavailable: "не установлен",
  available: "установлен",
};

export function redepositIdentityContractLabel(kind: string): string {
  return REDEPOSIT_IDENTITY_CONTRACT[kind] ?? kind;
}

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

/**
 * GROWTH-I18N — the operator copy that used to arrive in English from the API.
 *
 * WHAT WAS HAPPENING. Four payload fields — `rateModeExplanation`,
 * `attributionExplanation`, `unresolvedRedepositsMeaning` and
 * `totalDepositAmountNote` — carry English prose, and the CRM rendered them
 * verbatim into a Russian UI. Live Acceptance recorded it as LOW; the
 * product-wide closure's register omitted it; the final browser gate surfaced
 * it again. It pre-existed all three.
 *
 * WHY THE COPY MOVED HERE INSTEAD OF THE STRINGS BEING TRANSLATED UPSTREAM.
 * Those fields are part of the published API contract and are read by machine
 * consumers as well as by this screen. Translating them would change what the
 * API says to everyone in order to fix what one UI shows to one audience, and
 * the closure's own rule is not to alter a domain contract to make a surface
 * prettier. The payload keeps its canonical English; the operator UI owns its
 * own locale. That is also why this is a CRM-only correction.
 *
 * The meaning is preserved exactly — including the parts that are load-bearing:
 * a ratio is null rather than zero, a period is a cohort rather than a window,
 * an unresolved delivery is not money, and a deposit total covers first
 * deposits only.
 */
export const GROWTH_COPY = {
  /** Appended to the «Конверсии» section, which already explains the cohort rule. */
  rateMode:
    "Доля равна null, а не нулю, когда знаменатель равен нулю: это «нечего делить», " +
    "а не «ноль процентов».",

  attribution:
    "События разрезаются по ЗАФИКСИРОВАННОЙ атрибуции учащегося: она определяется " +
    "один раз при регистрации по модели последнего зачётного партнёрского клика. " +
    "Более поздний клик никогда не переатрибутирует существующего учащегося.",

  unresolvedRedepositsMeaning:
    "Доставки получены и проверены. НЕ считаются деньгами, потому что Pocket не " +
    "передаёт уникальный идентификатор события: повторную доставку невозможно " +
    "отличить от настоящего второго депозита. Это не счётчик нулевых редепозитов.",

  totalDepositAmount:
    "Учитываются ТОЛЬКО первые депозиты. Подтверждённые редепозиты структурно " +
    "равны нулю, пока не установлен контракт идентичности события у провайдера, " +
    "а доставки в карантине и с неопределённой идентичностью никогда не входят " +
    "ни в одну денежную сумму.",
} as const;

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
