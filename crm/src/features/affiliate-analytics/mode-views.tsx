"use client";

/**
 * AFD-5C1 — the summary blocks for the two modes.
 *
 * THE TWO ARE DELIBERATELY NOT INTERCHANGEABLE (§16). They share no metric
 * label, no rate label and no explanatory sentence. Event-date shows RATIOS OF
 * EVENTS with their denominators named; cohort shows CONVERSION OF A FIXED
 * POPULATION with its anchor, its cutoff and its follow-up window named. Nothing
 * below reuses one mode's copy for the other — that is the failure §16 exists to
 * prevent, and it is prevented by there being no shared component to reuse.
 */
import * as React from "react";
import type {
  CohortSummary,
  EventDateSummary,
  MetricsBlock,
} from "@/data/contracts/api/affiliate-analytics";
import {
  AMOUNT_TITLE,
  amountUnavailableReason,
  COHORT_CUTOFF_EXPLANATION,
  COHORT_EXPLANATION,
  COHORT_METRIC_LABEL,
  COHORT_RATE_LABEL,
  DENOMINATOR_LABEL,
  EVENT_DATE_EXPLANATION,
  EVENT_DATE_RATIO_EXPLANATION,
  exactSeconds,
  formatAmount,
  formatDuration,
  formatFollowupSeconds,
  formatSampleSize,
  MEDIAN_LABEL,
  METRIC_HINT,
  METRIC_LABEL,
  RATIO_LABEL,
} from "./analytics-labels";
import {
  InfoNote,
  MedianCard,
  MetricCard,
  RatioCard,
  SectionHeading,
} from "./analytics-primitives";

/* ----------------------------------------------------- first-deposit money */

/**
 * The first-deposit total, or an explicit explanation of why there is none.
 *
 * There is no third branch. The contract makes an amount without a currency
 * unrepresentable, so this cannot render a bare number, cannot fall back to USD
 * and cannot sum across currencies (§29).
 */
function FirstDepositAmount({
  amount,
}: {
  amount: EventDateSummary["firstDepositAmount"];
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <p className="text-xs leading-snug text-text-secondary">{AMOUNT_TITLE}</p>
      {/* Narrowed on the DISCRIMINANT: the unavailable branch carries no total
          and no currency code, so neither can be rendered from it. */}
      {amount.amountAggregationAvailable ? (
        <p className="mt-1 text-xl font-semibold tabular-nums text-text-primary">
          {formatAmount(amount)}
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm font-semibold text-text-muted">Недоступно</p>
          <p className="mt-1 text-[11px] leading-snug text-text-muted">
            {amountUnavailableReason(amount.unavailableReason)}
          </p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------- event-date summary */

const PRIMARY_METRICS = [
  "qualifiedClicks",
  "uniqueVisitors",
  "academyRegistrations",
  "pocketRegistrations",
  "confirmedFirstDeposits",
] as const;

const DEPOSIT_STATE_METRICS = ["pendingIdentityDeposits", "conflictingDeposits"] as const;

/** Click classification detail — present, but below the main hierarchy. */
const CLICK_DETAIL_METRICS = ["rawClicks", "prefetchClicks", "authenticatedUserClicks"] as const;

const RATIO_KEYS = [
  "qualifiedClickToAcademyRegistrationRate",
  "academyRegistrationToPocketRegistrationRate",
  "pocketRegistrationToFirstDepositRate",
  "qualifiedClickToPocketRegistrationRate",
  "qualifiedClickToFirstDepositRate",
] as const;

export function EventDateSummaryView({
  summary,
  block,
  coverageUnavailableNote,
}: {
  summary: EventDateSummary;
  /** The coverage slice being displayed, already selected by the caller. */
  block: MetricsBlock;
  coverageUnavailableNote?: string;
}) {
  return (
    <div className="space-y-5">
      <section aria-labelledby="event-metrics" className="space-y-3">
        <SectionHeading
          id="event-metrics"
          title="Показатели периода"
          description={EVENT_DATE_EXPLANATION}
        />
        {coverageUnavailableNote ? <InfoNote>{coverageUnavailableNote}</InfoNote> : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {PRIMARY_METRICS.map((metric) => (
            <MetricCard
              key={metric}
              label={METRIC_LABEL[metric]}
              value={block[metric]}
              hint={METRIC_HINT[metric]}
            />
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {DEPOSIT_STATE_METRICS.map((metric) => (
            <MetricCard
              key={metric}
              label={METRIC_LABEL[metric]}
              value={block[metric]}
              hint={METRIC_HINT[metric]}
              emphasis="muted"
            />
          ))}
          <FirstDepositAmount amount={summary.firstDepositAmount} />
        </div>

        {/* The full unique-visitor caveat lives beside the CHART, where the two
            numbers it compares are actually shown. Repeating it here as well was
            clutter; the metric card's own hint carries the short form. */}
      </section>

      <section aria-labelledby="event-click-detail" className="space-y-2">
        <SectionHeading
          id="event-click-detail"
          level={3}
          title="Классификация кликов"
          description="Из сырых кликов исключаются prefetch и клики уже авторизованных пользователей — остаются квалифицированные."
        />
        <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-3">
          {CLICK_DETAIL_METRICS.map((metric) => (
            <div key={metric} className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
              <dt className="text-xs text-text-secondary">{METRIC_LABEL[metric]}</dt>
              <dd className="shrink-0 text-sm tabular-nums text-text-primary">
                {block[metric].toLocaleString("ru-RU")}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="event-ratios" className="space-y-3">
        <SectionHeading
          id="event-ratios"
          title="Соотношения событий периода"
          // The backend ships this sentence in the payload so the caveat cannot
          // be lost by a second client; it is rendered verbatim beside ours.
          // The backend's own `rateModeExplanation` says the same thing in
          // English and is deliberately NOT printed here: this is a Russian
          // operator surface, and an untranslated sentence beside a translated
          // one reads as a leak rather than as a caveat. The caveat itself is
          // not lost — it is the sentence above.
          description={EVENT_DATE_RATIO_EXPLANATION}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {RATIO_KEYS.map((key) => (
            <RatioCard
              key={key}
              label={RATIO_LABEL[key]}
              value={block.ratios[key]}
              denominatorLabel={
                DENOMINATOR_LABEL[summary.ratioDenominators[key]] ?? summary.ratioDenominators[key]
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}

/* ----------------------------------------------------------- cohort summary */

const MEDIAN_KEYS = [
  "selectedClickToAcademyRegistration",
  "academyRegistrationToPocketRegistration",
  "pocketRegistrationToFirstDeposit",
] as const;

export function CohortSummaryView({ summary }: { summary: CohortSummary }) {
  const { followup, reportCutoff } = summary;

  return (
    <div className="space-y-5">
      <section aria-labelledby="cohort-metrics" className="space-y-3">
        <SectionHeading
          id="cohort-metrics"
          title="Когорта привлечения"
          // As above: `cohortModeExplanation` is the backend's English wording
          // of the same caveat and is not printed into a Russian surface.
          description={COHORT_EXPLANATION}
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label={COHORT_METRIC_LABEL.cohortLearners}
            value={summary.metrics.cohortLearners}
            hint="Зарегистрированные пользователи с атрибуцией, привлечённые в выбранном периоде"
          />
          <MetricCard
            label={COHORT_METRIC_LABEL.pocketRegisteredLearners}
            value={summary.metrics.pocketRegisteredLearners}
          />
          <MetricCard
            label={COHORT_METRIC_LABEL.firstDepositLearners}
            value={summary.metrics.firstDepositLearners}
          />
          <FirstDepositAmount amount={summary.firstDepositAmount} />
        </div>
      </section>

      <section aria-labelledby="cohort-rates" className="space-y-3">
        <SectionHeading
          id="cohort-rates"
          title="Конверсия когорты"
          description="Числитель и знаменатель описывают одних и тех же пользователей, наблюдаемых до отсечки. Это наблюдаемая конверсия, а не причинно-следственная связь и не прогноз."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {(["pocketRegistrationRate", "firstDepositRate", "pocketToFirstDepositRate"] as const).map(
            (key) => (
              <RatioCard
                key={key}
                label={COHORT_RATE_LABEL[key]}
                value={summary.rates[key]}
                denominatorLabel={
                  DENOMINATOR_LABEL[summary.rateDenominators[key]] ?? summary.rateDenominators[key]
                }
              />
            ),
          )}
        </div>
      </section>

      <section aria-labelledby="cohort-medians" className="space-y-3">
        <SectionHeading
          id="cohort-medians"
          title="Медианные задержки"
          description="Медиана, а не среднее: один пользователь, задепонировавший через год, сместил бы среднее далеко от типичного случая."
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {MEDIAN_KEYS.map((key) => {
            const median = summary.medianLags[key];
            return (
              <MedianCard
                key={key}
                label={MEDIAN_LABEL[key]}
                display={formatDuration(median.medianSeconds)}
                exact={exactSeconds(median.medianSeconds)}
                sampleSize={median.sampleSize}
                sampleLabel={formatSampleSize(median.sampleSize)}
                negativeDurationCount={median.negativeDurationCount}
              />
            );
          })}
        </div>
      </section>

      <section aria-labelledby="cohort-followup" className="space-y-2">
        <SectionHeading
          id="cohort-followup"
          level={3}
          title="Окно наблюдения"
          description={COHORT_CUTOFF_EXPLANATION}
        />
        <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
            <dt className="text-xs text-text-secondary">Якорь когорты</dt>
            <dd className="shrink-0 break-words text-right text-xs text-text-primary">Выбранный атрибуционный клик</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
            <dt className="text-xs text-text-secondary">Отсечка наблюдения</dt>
            <dd className="shrink-0 text-xs tabular-nums text-text-primary">
              {reportCutoff.cutoffLocal}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
            <dt className="text-xs text-text-secondary">Минимальное наблюдение</dt>
            <dd className="shrink-0 break-words text-right text-xs text-text-primary">
              {formatFollowupSeconds(followup.minimumPossibleFollowupSeconds) ?? "—"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
            <dt className="text-xs text-text-secondary">Максимальное наблюдение</dt>
            <dd className="shrink-0 break-words text-right text-xs text-text-primary">
              {formatFollowupSeconds(followup.maximumPossibleFollowupSeconds) ?? "Не ограничено"}
            </dd>
          </div>
          {/* Stacked: this answer is a sentence, and side by side it would
              squeeze its own label out of existence at narrow widths. */}
          <div className="border-b border-border/60 pb-1.5 sm:col-span-2">
            <dt className="text-xs text-text-secondary">Когорта полностью до отсечки</dt>
            <dd className="mt-0.5 break-words text-xs leading-snug text-text-primary">
              {followup.cohortIntervalFullyBeforeCutoff
                ? "Да — каждый участник наблюдался не меньше минимального срока"
                : "Нет — часть когорты привлечена после отсечки и ещё не наблюдалась"}
            </dd>
          </div>
        </dl>
        {/* Stated explicitly so nobody reads the window above as a readiness
            verdict. The backend ships `not_scored` and this says why. */}
        <InfoNote>
          Это факты об окне наблюдения, а не оценка зрелости когорты: эмпирическая модель
          зрелости не реализована, поэтому отчёт не утверждает, достаточно ли этого срока.
        </InfoNote>
      </section>

      <section aria-labelledby="cohort-boundaries" className="space-y-2">
        <SectionHeading id="cohort-boundaries" level={3} title="Границы режима" />
        <InfoNote tone="warning">
          Прямые регистрации без атрибуционного клика в когорту не входят: у них нет якоря
          привлечения. Они полностью видны в режиме «По дате события». Конверсия анонимного
          посетителя в регистрацию не измеряется — у незарегистрированного посетителя нет
          зафиксированного выбранного клика.
        </InfoNote>
        <p className="text-[11px] leading-snug text-text-muted">
          Режимы отвечают на разные вопросы, поэтому их итоги за один и тот же календарный
          период не обязаны совпадать.
        </p>
      </section>
    </div>
  );
}
