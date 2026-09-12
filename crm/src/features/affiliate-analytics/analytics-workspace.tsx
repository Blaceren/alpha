"use client";

/**
 * AFD-5C1 — the affiliate analytics workspace.
 *
 * THE URL IS THE SINGLE SOURCE OF TRUTH. This component holds no copy of the
 * filter state: it parses `useSearchParams()` on every render and writes changes
 * back with `router.push`. Back, forward, reload and a pasted link therefore all
 * restore the same screen by the same code path, and there is no second state to
 * drift out of sync with the address bar.
 *
 * ONE URL TRANSITION ISSUES ONE REQUEST PER SECTION. Each section's effect is
 * keyed on its own serialized query, so a state change that does not affect a
 * section (switching the breakdown dimension, say) does not re-request the
 * summary. The inactive mode's endpoints are never requested at all.
 *
 * WHAT THIS COMPONENT NEVER CALLS: `/api/crm/v1/affiliates/leads` and its detail
 * and reveal routes. There is no import that could reach them, and the CRM
 * origin does not forward them.
 */
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/states/empty-state";
import {
  ANALYTICS_BREAKDOWN_LIMIT,
  buildQuery,
  fetchAnalyticsFilters,
  fetchCohortBreakdown,
  fetchCohortSummary,
  fetchCohortTimeseries,
  fetchEventDateBreakdown,
  fetchEventDateSummary,
  fetchEventDateTimeseries,
} from "@/application/api/affiliate-analytics-client";
import type {
  BreakdownDimension,
  BucketGroup,
  CohortBreakdown,
  CohortSummary,
  CohortTimeseries,
  DatePreset,
  EventDateBreakdown,
  EventDateSummary,
  EventDateTimeseries,
  MetricsBlock,
} from "@/data/contracts/api/affiliate-analytics";
import { useAffiliateAccess } from "@/features/affiliates/use-affiliate-access";
import { AffiliateSectionTabs } from "@/features/affiliates/affiliate-section-tabs";
import {
  CoverageSelector,
  CutoffControl,
  FilterControls,
  GroupSelector,
  ModeSelector,
  PeriodControls,
} from "./analytics-controls";
import {
  AvailabilityList,
  ErrorBlock,
  InfoNote,
  LoadingBlock,
  RefreshingBadge,
  SectionHeading,
} from "./analytics-primitives";
import {
  COHORT_METRIC_LABEL,
  COVERAGE_LABEL,
  describeAnalyticsFailure,
  failureRequestId,
  LEAD_DRILLDOWN_UI_NOTE,
  METRIC_LABEL,
  MODE_LABEL,
  PERIOD_CONTRACT_NOTE,
  UNIQUE_VISITOR_NOTE,
} from "./analytics-labels";
import { CohortSummaryView, EventDateSummaryView } from "./mode-views";
import {
  CohortBreakdownTable,
  DimensionSelector,
  EventDateBreakdownTable,
  Pagination,
} from "./breakdown-table";
import { SeriesChart, type ChartBucket, type ChartSeries } from "./series-chart";
import { useAnalyticsSection } from "./use-analytics-section";
import {
  applyAnalyticsChange,
  filterQuery,
  isFiltered,
  parseAnalyticsUrlState,
  periodQuery,
  serializeAnalyticsUrlState,
  type AnalyticsUrlState,
} from "./analytics-url-state";

/* ------------------------------------------------------------ chart series */

const token = (name: string) => `hsl(var(--color-${name}))`;

/**
 * The selectable event-date series.
 *
 * COUNTS ONLY. Rates live in their own chart with their own axis — §31 forbids
 * counts and percentages sharing an unlabelled scale, and this list is where
 * that separation is enforced.
 */
const EVENT_SERIES: readonly ChartSeries[] = [
  { key: "qualifiedClicks", label: METRIC_LABEL.qualifiedClicks, color: token("accent"), pattern: "solid" },
  { key: "bucketUniqueVisitors", label: "Уникальные посетители (за столбец)", color: token("info"), pattern: "hatch" },
  { key: "academyRegistrations", label: METRIC_LABEL.academyRegistrations, color: token("success"), pattern: "solid" },
  { key: "pocketRegistrations", label: METRIC_LABEL.pocketRegistrations, color: token("warning"), pattern: "dots" },
  { key: "confirmedFirstDeposits", label: METRIC_LABEL.confirmedFirstDeposits, color: token("danger"), pattern: "solid" },
  { key: "pendingIdentityDeposits", label: METRIC_LABEL.pendingIdentityDeposits, color: token("text-secondary"), pattern: "hatch" },
  { key: "conflictingDeposits", label: METRIC_LABEL.conflictingDeposits, color: token("text-muted"), pattern: "dots" },
];

const DEFAULT_EVENT_SERIES = [
  "qualifiedClicks",
  "academyRegistrations",
  "pocketRegistrations",
  "confirmedFirstDeposits",
];

const COHORT_SERIES: readonly ChartSeries[] = [
  { key: "cohortLearners", label: COHORT_METRIC_LABEL.cohortLearners, color: token("accent"), pattern: "solid" },
  { key: "pocketRegisteredLearners", label: COHORT_METRIC_LABEL.pocketRegisteredLearners, color: token("warning"), pattern: "dots" },
  { key: "firstDepositLearners", label: COHORT_METRIC_LABEL.firstDepositLearners, color: token("success"), pattern: "hatch" },
];

const COHORT_RATE_SERIES: readonly ChartSeries[] = [
  { key: "pocketRegistrationRate", label: "Доля дошедших до Pocket", color: token("warning"), pattern: "dots" },
  { key: "firstDepositRate", label: "Доля дошедших до первого депозита", color: token("success"), pattern: "hatch" },
];

/* ---------------------------------------------------------------- workspace */

export function AffiliateAnalyticsWorkspace() {
  const { canRead } = useAffiliateAccess();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Parsed fresh from the URL on every render — see the header.
  const state = React.useMemo(
    () => parseAnalyticsUrlState(searchParams.toString()),
    [searchParams],
  );

  const [selectedSeries, setSelectedSeries] = React.useState<readonly string[]>(
    DEFAULT_EVENT_SERIES,
  );

  const update = React.useCallback(
    (change: Partial<AnalyticsUrlState>) => {
      const next = applyAnalyticsChange(state, change);
      const serialized = serializeAnalyticsUrlState(next);
      // A no-op change pushes no history entry, so Back never has to be pressed
      // twice to leave a state the operator never chose.
      if (serialized === serializeAnalyticsUrlState(state)) return;
      router.push(`${pathname}${serialized}`);
    },
    [pathname, router, state],
  );

  const eventMode = state.mode === "event_date";
  const filtered = isFiltered(state);

  /* ---------------------------------------------------------- request keys */

  const baseQuery = React.useMemo(
    () => ({ ...periodQuery(state), ...filterQuery(state) }),
    [state],
  );

  const filtersKey = buildQuery({
    ...(state.affiliatePartnerId !== null ? { affiliatePartnerId: state.affiliatePartnerId } : {}),
    ...(state.affiliateCampaignId !== null
      ? { affiliateCampaignId: state.affiliateCampaignId }
      : {}),
  });
  const summaryKey = buildQuery({
    ...baseQuery,
    ...(state.cutoffDate !== null ? { cutoffDate: state.cutoffDate } : {}),
  });
  const seriesKey = buildQuery({
    ...baseQuery,
    ...(state.cutoffDate !== null ? { cutoffDate: state.cutoffDate } : {}),
    group: state.group,
  });
  const breakdownKey = buildQuery({
    ...baseQuery,
    ...(state.cutoffDate !== null ? { cutoffDate: state.cutoffDate } : {}),
    dimension: state.dimension,
    limit: ANALYTICS_BREAKDOWN_LIMIT,
    offset: state.offset,
  });

  /* ------------------------------------------------------------- sections */

  const filters = useAnalyticsSection(`filters${filtersKey}`, canRead, (signal) =>
    fetchAnalyticsFilters(
      {
        ...(state.affiliatePartnerId !== null
          ? { affiliatePartnerId: state.affiliatePartnerId }
          : {}),
        ...(state.affiliateCampaignId !== null
          ? { affiliateCampaignId: state.affiliateCampaignId }
          : {}),
      },
      { signal },
    ),
  );

  const eventSummary = useAnalyticsSection<EventDateSummary>(
    `event-summary${summaryKey}`,
    canRead && eventMode,
    (signal) => fetchEventDateSummary(baseQuery, { signal }),
  );

  const eventSeries = useAnalyticsSection<EventDateTimeseries>(
    `event-series${seriesKey}`,
    canRead && eventMode,
    (signal) => fetchEventDateTimeseries({ ...baseQuery, group: state.group }, { signal }),
  );

  const eventBreakdown = useAnalyticsSection<EventDateBreakdown>(
    `event-breakdown${breakdownKey}`,
    canRead && eventMode,
    (signal) =>
      fetchEventDateBreakdown(
        {
          ...baseQuery,
          dimension: state.dimension,
          limit: ANALYTICS_BREAKDOWN_LIMIT,
          offset: state.offset,
        },
        { signal },
      ),
  );

  const cohortQuery = React.useMemo(
    () => ({
      ...baseQuery,
      ...(state.cutoffDate !== null ? { cutoffDate: state.cutoffDate } : {}),
    }),
    [baseQuery, state.cutoffDate],
  );

  const cohortSummary = useAnalyticsSection<CohortSummary>(
    `cohort-summary${summaryKey}`,
    canRead && !eventMode,
    (signal) => fetchCohortSummary(cohortQuery, { signal }),
  );

  const cohortSeries = useAnalyticsSection<CohortTimeseries>(
    `cohort-series${seriesKey}`,
    canRead && !eventMode,
    (signal) => fetchCohortTimeseries({ ...cohortQuery, group: state.group }, { signal }),
  );

  const cohortBreakdown = useAnalyticsSection<CohortBreakdown>(
    `cohort-breakdown${breakdownKey}`,
    canRead && !eventMode,
    (signal) =>
      fetchCohortBreakdown(
        {
          ...cohortQuery,
          dimension: state.dimension,
          limit: ANALYTICS_BREAKDOWN_LIMIT,
          offset: state.offset,
        },
        { signal },
      ),
  );

  /* ------------------------------------------------------------- denied */

  // The backend remains authoritative and answers 403 regardless; this only
  // avoids rendering a workspace that could never load.
  if (!canRead) {
    return (
      <div className="space-y-4">
        <PageHeader title="Аналитика аффилейтов" />
        <EmptyState
          title="Недостаточно прав"
          description="Для просмотра аналитики аффилейтов нужно право view_affiliate_analytics или manage_settings."
        />
      </div>
    );
  }

  /* -------------------------------------------------------- derived views */

  const summaryData = eventMode ? eventSummary.data : cohortSummary.data;
  const resolvedPeriod = eventMode
    ? (eventSummary.data?.period ?? null)
    : (cohortSummary.data?.cohortPeriod ?? null);

  const coverageBlock: MetricsBlock | null = (() => {
    const data = eventSummary.data;
    if (data === null) return null;
    if (filtered) return data.coverage.attributed;
    if (state.coverage === "attributed") return data.coverage.attributed;
    if (state.coverage === "unattributed") return data.coverage.unattributed;
    return data.coverage.total;
  })();

  const eventChartBuckets: ChartBucket[] =
    eventSeries.data?.buckets.map((bucket) => ({
      // The BACKEND's label and the BACKEND's order. No client regrouping.
      label: bucket.localLabel,
      values: bucket.metrics as unknown as Record<string, number>,
    })) ?? [];

  const cohortChartBuckets: ChartBucket[] =
    cohortSeries.data?.buckets.map((bucket) => ({
      label: bucket.localLabel,
      values: bucket.metrics as unknown as Record<string, number>,
    })) ?? [];

  const cohortRateBuckets: ChartBucket[] =
    cohortSeries.data?.buckets.map((bucket) => ({
      label: bucket.localLabel,
      values: {
        pocketRegistrationRate: bucket.rates.pocketRegistrationRate,
        firstDepositRate: bucket.rates.firstDepositRate,
      },
    })) ?? [];

  const activeEventSeries = EVENT_SERIES.filter((item) => selectedSeries.includes(item.key));

  const breakdownState = eventMode ? eventBreakdown : cohortBreakdown;
  const breakdownTotal = eventMode
    ? (eventBreakdown.data?.total ?? 0)
    : (cohortBreakdown.data?.total ?? 0);

  const availability = eventMode
    ? (eventSummary.data?.dataAvailability ?? null)
    : (cohortSummary.data?.dataAvailability ?? null);

  /* ------------------------------------------------------------- render */

  return (
    <div className="space-y-5">
      <PageHeader
        title="Аналитика аффилейтов"
        description="Трафик, регистрации и первые депозиты по аффилейтам, кампаниям и ссылкам."
      />
      <AffiliateSectionTabs active="analytics" />

      {/* Mode change is announced: every number below changes meaning. */}
      <p className="sr-only" role="status" aria-live="polite">
        Режим отчёта: {MODE_LABEL[state.mode]}
      </p>

      <section aria-labelledby="analytics-controls" className="space-y-4 rounded-md border border-border bg-surface p-2 sm:p-4">
        <SectionHeading id="analytics-controls" title="Параметры отчёта" level={3} />
        <ModeSelector mode={state.mode} onChange={(mode) => update({ mode })} />

        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <PeriodControls
            preset={state.preset}
            startDate={state.startDate}
            endDate={state.endDate}
            resolvedPeriod={resolvedPeriod}
            onChange={(change) =>
              update({
                preset: change.preset as DatePreset,
                startDate: change.startDate,
                endDate: change.endDate,
              })
            }
          />
          <div className="min-w-0 space-y-3">
            <GroupSelector
              group={state.group}
              onChange={(group) => update({ group: group as BucketGroup })}
            />
            {!eventMode ? (
              <CutoffControl
                cutoffDate={state.cutoffDate}
                reportCutoff={cohortSummary.data?.reportCutoff ?? null}
                onChange={(cutoffDate) => update({ cutoffDate })}
              />
            ) : null}
          </div>
        </div>

        <FilterControls
          options={filters.data}
          state={state}
          onChange={(change) => update(change)}
        />

        {eventMode ? (
          <CoverageSelector
            coverage={state.coverage}
            filtered={filtered}
            onChange={(coverage) => update({ coverage })}
          />
        ) : null}

        <p className="text-[11px] leading-snug text-text-muted">{PERIOD_CONTRACT_NOTE}</p>
      </section>

      {/* ------------------------------------------------------- summary */}

      <section aria-labelledby="analytics-summary" className="space-y-3">
        <SectionHeading
          id="analytics-summary"
          title="Сводка"
          actions={
            (eventMode ? eventSummary.refreshing : cohortSummary.refreshing) ? (
              <RefreshingBadge />
            ) : null
          }
        />

        {eventMode ? (
          eventSummary.loading ? (
            <LoadingBlock label="Загружаем сводку…" />
          ) : eventSummary.failure !== null && eventSummary.data === null ? (
            <ErrorBlock
              message={describeAnalyticsFailure(eventSummary.failure)}
              requestId={failureRequestId(eventSummary.failure)}
              onRetry={eventSummary.reload}
            />
          ) : eventSummary.data !== null && coverageBlock !== null ? (
            <EventDateSummaryView
              summary={eventSummary.data}
              block={coverageBlock}
              coverageUnavailableNote={
                filtered
                  ? "Активен фильтр по аффилейту, кампании или ссылке: показаны только совпадающие записи с атрибуцией."
                  : `Показан срез «${COVERAGE_LABEL[state.coverage]}».`
              }
            />
          ) : (
            <EmptyState
              title="Нет данных за период"
              description="В выбранном периоде не зафиксировано ни одного события."
            />
          )
        ) : cohortSummary.loading ? (
          <LoadingBlock label="Загружаем когорту…" />
        ) : cohortSummary.failure !== null && cohortSummary.data === null ? (
          <ErrorBlock
            message={describeAnalyticsFailure(cohortSummary.failure)}
            requestId={failureRequestId(cohortSummary.failure)}
            onRetry={cohortSummary.reload}
          />
        ) : cohortSummary.data !== null ? (
          <CohortSummaryView summary={cohortSummary.data} />
        ) : (
          <EmptyState
            title="Когорта пуста"
            description="В выбранном периоде нет привлечённых зарегистрированных пользователей."
          />
        )}
      </section>

      {/* --------------------------------------------------------- chart */}

      <section aria-labelledby="analytics-chart" className="space-y-3">
        <SectionHeading
          id="analytics-chart"
          title={eventMode ? "Динамика событий" : "Динамика когорт"}
          description={
            eventMode
              ? "Каждый столбец — интервал, в котором произошли события."
              : "Каждый столбец — интервал привлечения. Все столбцы наблюдаются до одной и той же отсечки, поэтому сравнимы между собой."
          }
          actions={
            (eventMode ? eventSeries.refreshing : cohortSeries.refreshing) ? <RefreshingBadge /> : null
          }
        />

        {eventMode ? (
          <>
            {/* Series selection. Counts only — see EVENT_SERIES. */}
            <fieldset className="min-w-0 rounded-md border border-border bg-surface p-2 sm:p-3">
              <legend className="break-words px-1 text-xs font-medium text-text-secondary">
                Показатели на графике
              </legend>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
                {EVENT_SERIES.map((item) => (
                  <label
                    key={item.key}
                    className="flex min-w-0 items-center gap-1.5 break-words text-xs text-text-secondary"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSeries.includes(item.key)}
                      onChange={(event) =>
                        setSelectedSeries((current) =>
                          event.target.checked
                            ? [...current, item.key]
                            : current.filter((key) => key !== item.key),
                        )
                      }
                      className="h-3.5 w-3.5 shrink-0 accent-[hsl(var(--color-accent))]"
                    />
                    <span className="min-w-0 break-words">{item.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {eventSeries.loading ? (
              <LoadingBlock label="Загружаем график…" />
            ) : eventSeries.failure !== null && eventSeries.data === null ? (
              <ErrorBlock
                message={describeAnalyticsFailure(eventSeries.failure)}
                requestId={failureRequestId(eventSeries.failure)}
                onRetry={eventSeries.reload}
              />
            ) : (
              <>
                <SeriesChart
                  buckets={eventChartBuckets}
                  series={activeEventSeries}
                  kind="count"
                  title="Динамика событий"
                  valueAxisLabel="количество событий"
                  emptyMessage="За выбранный период нет интервалов для отображения."
                />
                {eventSeries.data !== null ? (
                  <InfoNote>
                    {/* The BACKEND's two numbers, with the Russian statement of
                        why they differ. The backend also ships an English
                        sentence saying the same thing; it is not printed into a
                        Russian surface. */}
                    {UNIQUE_VISITOR_NOTE} Уникальных посетителей за период:{" "}
                    {eventSeries.data.periodUniqueVisitors.toLocaleString("ru-RU")}; сумма по
                    столбцам:{" "}
                    {eventSeries.data.summedBucketUniqueVisitors.toLocaleString("ru-RU")}.
                  </InfoNote>
                ) : null}
              </>
            )}
          </>
        ) : cohortSeries.loading ? (
          <LoadingBlock label="Загружаем график когорт…" />
        ) : cohortSeries.failure !== null && cohortSeries.data === null ? (
          <ErrorBlock
            message={describeAnalyticsFailure(cohortSeries.failure)}
            requestId={failureRequestId(cohortSeries.failure)}
            onRetry={cohortSeries.reload}
          />
        ) : (
          <div className="space-y-4">
            <SeriesChart
              buckets={cohortChartBuckets}
              series={COHORT_SERIES}
              kind="count"
              title="Численность когорт"
              valueAxisLabel="количество пользователей"
              emptyMessage="За выбранный период нет когорт для отображения."
            />
            {/* A SEPARATE chart with its own 0–100 % axis. Counts and rates are
                never drawn on one scale. */}
            <SeriesChart
              buckets={cohortRateBuckets}
              series={COHORT_RATE_SERIES}
              kind="rate"
              title="Конверсия когорт"
              valueAxisLabel="доля когорты"
              emptyMessage="Нет когорт с достаточными данными для расчёта долей."
            />
            {cohortSeries.data !== null ? (
              <InfoNote>
                Численность когорт по столбцам суммируется в итог. Доли и медианы — нет: доли
                пересчитываются от итоговых чисел, а медиана медиан не является медианой.
              </InfoNote>
            ) : null}
          </div>
        )}
      </section>

      {/* ----------------------------------------------------- breakdown */}

      <section aria-labelledby="analytics-breakdown" className="space-y-3">
        <SectionHeading
          id="analytics-breakdown"
          title="Детализация"
          actions={
            <div className="flex items-center gap-2">
              {breakdownState.refreshing ? <RefreshingBadge /> : null}
              <DimensionSelector
                dimension={state.dimension}
                onChange={(dimension) => update({ dimension: dimension as BreakdownDimension })}
              />
            </div>
          }
        />

        {breakdownState.loading ? (
          <LoadingBlock label="Загружаем детализацию…" />
        ) : breakdownState.failure !== null && breakdownState.data === null ? (
          <ErrorBlock
            message={describeAnalyticsFailure(breakdownState.failure)}
            requestId={failureRequestId(breakdownState.failure)}
            onRetry={breakdownState.reload}
          />
        ) : eventMode && eventBreakdown.data !== null ? (
          eventBreakdown.data.rows.length === 0 ? (
            <EmptyState
              title="Нет строк"
              description="В выбранном периоде и разрезе не зафиксировано активности."
            />
          ) : (
            <>
              <EventDateBreakdownTable rows={eventBreakdown.data.rows} />
              <Pagination
                total={breakdownTotal}
                limit={eventBreakdown.data.limit}
                offset={eventBreakdown.data.offset}
                onOffsetChange={(offset) => update({ offset })}
              />
            </>
          )
        ) : !eventMode && cohortBreakdown.data !== null ? (
          cohortBreakdown.data.rows.length === 0 ? (
            <EmptyState
              title="Нет строк"
              description="В выбранном периоде и разрезе нет привлечённых пользователей."
            />
          ) : (
            <>
              <CohortBreakdownTable rows={cohortBreakdown.data.rows} />
              <Pagination
                total={breakdownTotal}
                limit={cohortBreakdown.data.limit}
                offset={cohortBreakdown.data.offset}
                onOffsetChange={(offset) => update({ offset })}
              />
            </>
          )
        ) : null}
      </section>

      {/* -------------------------------------------------- availability */}

      {availability !== null ? (
        <section aria-labelledby="analytics-availability" className="space-y-3 rounded-md border border-border bg-surface p-2 sm:p-4">
          <SectionHeading
            id="analytics-availability"
            level={3}
            title="Доступность данных"
            description="Недоступное показано как недоступное с причиной, а не как ноль."
          />
          <AvailabilityList
            entries={availability}
            overrides={{ leadDrilldown: LEAD_DRILLDOWN_UI_NOTE }}
          />
        </section>
      ) : null}

      {summaryData !== null ? (
        <p className="text-[11px] text-text-muted">
          Отчёт построен: {new Date(summaryData.generatedAt).toLocaleString("ru-RU")}
        </p>
      ) : null}
    </div>
  );
}
