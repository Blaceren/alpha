"use client";

/**
 * G4-GROWTH — the internal staff Growth workspace.
 *
 * FIVE SUB-SURFACES, ONE PERIOD. Overview, CRO funnel, acquisition quality,
 * Pocket conversions and ingress health. The date period is shared across all of
 * them, because an operator comparing a funnel against a deposit count needs
 * both to describe the same window — and two independent pickers is how they
 * end up not doing.
 *
 * THIS IS NOT THE AFFILIATE PARTNER PORTAL. Only ATA staff reach it: the section
 * is gated by `SECTION_VISIBILITY.growth` in the navigation canon, and each
 * backend route independently enforces the CRM affiliate-reader authorization
 * before any read. Nothing here is scoped by a caller-supplied affiliate id
 * acting as authorization — the filters narrow what is SHOWN, never what the
 * caller is ENTITLED to.
 *
 * PROGRESSIVE DISCLOSURE, NOT THIRTY FILTERS (§41). One period control and one
 * tab strip are always visible. The partner/campaign filters live on the
 * surfaces that can use them, and the level ceiling only appears on the funnel.
 */
import * as React from "react";
import {
  fetchGrowthAcquisition,
  fetchGrowthFunnel,
  fetchGrowthIngressHealth,
  fetchGrowthOverview,
  fetchGrowthPocketConversions,
  type GrowthOutcome,
} from "@/application/api/growth-client";
import type {
  GrowthAcquisition,
  GrowthFunnel,
  GrowthIngressHealth,
  GrowthOverview,
  GrowthPocketConversions,
} from "@/data/contracts/api/growth";
import {
  AvailabilityList,
  ErrorBlock,
  GrowthMetric,
  GrowthNote,
  GrowthRatio,
  GrowthSection,
  LoadingBlock,
} from "./growth-primitives";
import Link from "next/link";
import { GROWTH_ROUTES, type GrowthSurface } from "./growth-routes";
import {
  DIMENSION_LABEL,
  FUNNEL_STEP_LABEL,
  INGRESS_STATUS_LABEL,
  PRESET_LABEL,
  PRESET_ORDER,
  GROWTH_COPY,
  amountUnavailableReason,
  availabilityReason,
  redepositIdentityContractLabel,
  registrationScopeHint,
  formatAmount,
  formatCount,
  formatRatio,
} from "./growth-labels";

/**
 * G4-R1 — the surface comes from the URL, not from component state.
 *
 * The tab strip below is a set of real links, so each surface is addressable,
 * reloadable and reachable with the browser's back button. `GROWTH_ROUTES` is
 * the same definition both CRM shells route with — see `growth-routes.ts`.
 */

/** Map a closed outcome to the one sentence an operator can act on. */
function outcomeMessage(status: string): string {
  switch (status) {
    case "unauthenticated":
      return "Сессия истекла. Войдите заново.";
    case "forbidden":
      return "Недостаточно прав для просмотра Growth-аналитики.";
    case "invalid_input":
      return "Некорректные параметры запроса.";
    case "rate_limited":
      return "Слишком много запросов. Повторите позже.";
    case "misconfigured":
      return "Аналитика настроена некорректно (часовой пояс). Это не ошибка запроса.";
    case "malformed_response":
      return "Ответ не соответствует контракту — данные не отображаются, чтобы не показать неполную картину.";
    default:
      return "Сервис аналитики недоступен.";
  }
}

function useGrowthData<T>(
  loader: (signal: AbortSignal) => Promise<GrowthOutcome<T>>,
  deps: React.DependencyList,
) {
  const [state, setState] = React.useState<
    { kind: "loading" } | { kind: "ready"; data: T } | { kind: "error"; message: string; requestId?: string }
  >({ kind: "loading" });

  React.useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });

    loader(controller.signal).then((outcome) => {
      if (controller.signal.aborted) return;
      // A cancelled request is the workspace superseding itself, not a failure.
      // Reporting it would flash a false error on every period change.
      if (outcome.status === "cancelled") return;
      if (outcome.status === "success") {
        setState({ kind: "ready", data: outcome.data });
        return;
      }
      setState({
        kind: "error",
        message: outcomeMessage(outcome.status),
        requestId: "requestId" in outcome ? outcome.requestId : undefined,
      });
    });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

export function GrowthWorkspace({ surface = "overview" }: { surface?: GrowthSurface }) {
  const tab = surface;
  const [preset, setPreset] = React.useState<string>("last_30_days");

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-lg font-semibold text-text-primary">Growth</h1>
        <p className="max-w-3xl text-xs leading-relaxed text-text-secondary">
          Внутренняя аналитика привлечения и конверсии. Это не партнёрский кабинет:
          данные видны только сотрудникам ATA.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-text-secondary" htmlFor="growth-preset">
          Период
        </label>
        <select
          id="growth-preset"
          value={preset}
          onChange={(event) => setPreset(event.target.value)}
          className="rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary"
        >
          {PRESET_ORDER.map((key) => (
            <option key={key} value={key}>
              {PRESET_LABEL[key] ?? key}
            </option>
          ))}
        </select>
      </div>

      <nav aria-label="Разделы Growth" className="flex flex-wrap gap-1 border-b border-border">
        {GROWTH_ROUTES.map((entry) => (
          <Link
            key={entry.surface}
            href={entry.path}
            aria-current={tab === entry.surface ? "page" : undefined}
            className={
              tab === entry.surface
                ? "border-b-2 border-primary px-3 py-1.5 text-xs font-medium text-text-primary"
                : "px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
            }
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? <OverviewTab preset={preset} /> : null}
      {tab === "funnel" ? <FunnelTab preset={preset} /> : null}
      {tab === "acquisition" ? <AcquisitionTab preset={preset} /> : null}
      {tab === "pocket" ? <PocketTab preset={preset} /> : null}
      {tab === "ingress" ? <IngressTab preset={preset} /> : null}
    </div>
  );
}

function OverviewTab({ preset }: { preset: string }) {
  const state = useGrowthData<GrowthOverview>(
    (signal) => fetchGrowthOverview({ preset }, { signal }),
    [preset],
  );

  if (state.kind === "loading") return <LoadingBlock label="Загружаем обзор…" />;
  if (state.kind === "error") {
    return <ErrorBlock message={state.message} requestId={state.requestId} />;
  }

  // COUNTS come from the TOTAL slice, so the headline includes organic
  // learners. RATIOS come from the ATTRIBUTED slice, and that distinction is
  // load-bearing rather than fussy: `clicks` only ever counts traffic that came
  // through a tracking link, while `total` registrations also include organic
  // signups that had no click at all. Dividing the second by the first would
  // produce a "click → registration" rate above 100% as soon as any learner
  // arrives organically — a number that looks like a bug and hides a real one.
  // G4-H4. The headline is the BUSINESS: every canonical event, whatever its
  // acquisition origin. The attributed block answers a different question and is
  // shown beside it as coverage, never instead of it.
  const counts = state.data.coverage.total ?? state.data.coverage.attributed;
  // G4-H3. Same-population ratios are read from the same block the counts came
  // from. The one click-denominated rate is read from the attributed block —
  // which is the only block in which the API defines it at all — and is labelled
  // as attributed traffic rather than as a generic registration rate.
  const ratioCounts = counts;
  const attributedRatios = state.data.coverage.attributed;
  const coverage = state.data.attributionCoverage;

  return (
    <div className="space-y-5">
      <GrowthSection title="Сводка">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
          <GrowthMetric label="Клики" value={counts.clicks} />
          {/* G4-R12. The figure is exact; the hint states the population it
              covers, so a reader never has to guess why «Активированы» can
              exceed it. `scope` is absent when every account is provable. */}
          <GrowthMetric
            label="Регистрации ATA"
            value={counts.ataRegistrations}
            hint={
              "scope" in state.data.dataAvailability.ataRegistrations &&
              state.data.dataAvailability.ataRegistrations.scope
                ? registrationScopeHint(state.data.dataAvailability.ataRegistrations.scope)
                : undefined
            }
          />
          <GrowthMetric label="Активированы" value={counts.activatedLearners} />
          <GrowthMetric label="Регистрации Pocket" value={counts.pocketRegistrations} />
          <GrowthMetric label="Первые депозиты" value={counts.firstDeposits} />
          {/* Confirmed redeposits ONLY. The unresolved count is deliberately not
              beside it — see the Pocket tab, where the distinction is the point. */}
          <GrowthMetric
            label="Редепозиты (подтв.)"
            value={counts.confirmedRedeposits}
            emphasis="muted"
            hint="Только подтверждённые"
          />
        </div>
      </GrowthSection>

      <GrowthSection
        title="Покрытие атрибуции"
        description="Сколько канонических регистраций удалось связать с кликом по трекинговой ссылке. Это метрика ПОКРЫТИЯ трекинга, а не конверсии кампании: низкое покрытие означает, что таблица источников трафика видит лишь часть бизнеса, а не что бизнеса нет."
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          <GrowthMetric
            label="Атрибутированные регистрации"
            value={coverage.attributedRegistrations}
            hint={`из ${coverage.totalRegistrations} всего`}
          />
          <GrowthRatio
            label="Покрытие атрибуции"
            value={coverage.attributionCoverageRate}
            denominatorLabel="все канонические регистрации ATA"
          />
        </div>
      </GrowthSection>

      <GrowthSection
        title="Конверсии"
        description={`Показатели «регистрация → …» считаются по УНИКАЛЬНЫМ учащимся: числитель — те, кто зарегистрировался в периоде И сделал следующий шаг, знаменатель — все зарегистрировавшиеся. Поэтому доля никогда не превышает 100%. Конверсия «клик → регистрация» считается по КОГОРТЕ КЛИКОВ: знаменатель — клики, совершённые в выбранном периоде, числитель — те же клики, которые привели к регистрации (когда бы она ни произошла). Поэтому регистрация в феврале по январскому клику относится к январской когорте, а не завышает февральскую долю. ${GROWTH_COPY.rateMode}`}
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          <GrowthRatio
            label="Клик → регистрация"
            value={attributedRatios.ratios.attributedClickToRegistrationRate}
            denominatorLabel="клики периода, давшие регистрацию / все клики периода"
          />
          <GrowthRatio
            label="Регистрация → активация"
            value={ratioCounts.ratios.activationRate}
            denominatorLabel="уникальные зарегистрированные учащиеся"
          />
          <GrowthRatio
            label="Регистрация → Pocket"
            value={ratioCounts.ratios.pocketRegistrationRate}
            denominatorLabel="уникальные зарегистрированные учащиеся"
          />
          <GrowthRatio
            label="Pocket → депозит"
            value={ratioCounts.ratios.depositRatePerPocketRegistration}
            denominatorLabel="регистрации Pocket"
          />
          <GrowthRatio
            label="Регистрация → депозит"
            value={ratioCounts.ratios.depositRatePerRegistration}
            denominatorLabel="уникальные зарегистрированные учащиеся"
          />
        </div>
      </GrowthSection>

      <GrowthSection title="Качество обучения">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <GrowthMetric label="Уровней начато" value={counts.levelStarted} />
          <GrowthMetric label="Уровней завершено" value={counts.levelCompleted} />
          <GrowthRatio
            label="Сдача тестов"
            value={ratioCounts.ratios.assessmentPassRate}
            denominatorLabel="завершённые попытки"
          />
          <GrowthRatio
            label="Одобрение отчётов"
            value={ratioCounts.ratios.submittedReportCohortApprovalRate}
            denominatorLabel="отчёты, отправленные в периоде (одобренные сегодня / все)"
          />
        </div>
      </GrowthSection>

      <GrowthSection title="Суммы первых депозитов">
        {state.data.firstDepositAmount.amountAggregationAvailable ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <div className="rounded-md border border-border bg-surface p-3">
              <p className="text-xs text-text-secondary">Сумма</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-text-primary">
                {formatAmount(
                  state.data.firstDepositAmount.sum,
                  state.data.firstDepositAmount.currencyCode,
                )}
              </p>
            </div>
            <div className="rounded-md border border-border bg-surface p-3">
              <p className="text-xs text-text-secondary">Среднее</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-text-primary">
                {formatAmount(
                  state.data.firstDepositAmount.average,
                  state.data.firstDepositAmount.currencyCode,
                )}
              </p>
            </div>
            <div className="rounded-md border border-border bg-surface p-3">
              <p className="text-xs text-text-secondary">Медиана</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-text-primary">
                {formatAmount(
                  state.data.firstDepositAmount.median,
                  state.data.firstDepositAmount.currencyCode,
                )}
              </p>
            </div>
          </div>
        ) : (
          <GrowthNote>
            Суммы не агрегируются:{" "}
            {amountUnavailableReason(state.data.firstDepositAmount.unavailableReason ?? "")}. Число
            депозитов при этом известно: {formatCount(state.data.firstDepositAmount.count)}.
          </GrowthNote>
        )}
      </GrowthSection>

      {/* GROWTH-I18N. The payload carries the canonical English for machine
          consumers; the operator UI renders its own locale. */}
      <GrowthNote>{GROWTH_COPY.attribution}</GrowthNote>
      <AvailabilityList availability={state.data.dataAvailability} />
    </div>
  );
}

function FunnelTab({ preset }: { preset: string }) {
  const [maxLevel, setMaxLevel] = React.useState(15);
  const state = useGrowthData<GrowthFunnel>(
    (signal) => fetchGrowthFunnel({ preset, maxLevel }, { signal }),
    [preset, maxLevel],
  );

  if (state.kind === "loading") return <LoadingBlock label="Загружаем воронку…" />;
  if (state.kind === "error") {
    return <ErrorBlock message={state.message} requestId={state.requestId} />;
  }

  return (
    <div className="space-y-5">
      <GrowthSection
        title="Воронка привлечения"
        description="Каждый шаг указывает собственный знаменатель — предыдущая строка не подразумевается."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="text-text-secondary">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Шаг</th>
                <th className="py-1.5 pr-3 font-medium">Количество</th>
                <th className="py-1.5 pr-3 font-medium">Доля от</th>
                <th className="py-1.5 pr-3 font-medium">Конверсия</th>
                <th className="py-1.5 font-medium">Отвал</th>
              </tr>
            </thead>
            <tbody className="text-text-primary">
              {state.data.acquisitionFunnel.steps.map((step) => (
                <tr key={step.step} className="border-t border-border">
                  <td className="py-1.5 pr-3">{FUNNEL_STEP_LABEL[step.step] ?? step.step}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{formatCount(step.count)}</td>
                  <td className="py-1.5 pr-3 text-text-secondary">
                    {step.ofStep ? (FUNNEL_STEP_LABEL[step.ofStep] ?? step.ofStep) : "—"}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">{formatRatio(step.rate)}</td>
                  <td className="py-1.5 tabular-nums text-text-secondary">
                    {step.dropOff === null ? "—" : formatCount(step.dropOff)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GrowthSection>

      <GrowthSection
        title="Воронка по уровням"
        description="Уровень без событий за период отсутствует в таблице — это не ноль."
      >
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-secondary" htmlFor="growth-max-level">
            До уровня
          </label>
          <input
            id="growth-max-level"
            type="number"
            min={1}
            max={100}
            value={maxLevel}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isInteger(next) && next >= 1 && next <= 100) setMaxLevel(next);
            }}
            className="w-20 rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary"
          />
        </div>

        <GrowthNote>
          Счёт ведётся по уникальным парам «запись на курс + уровень», а не по
          событиям. «Начали → завершили» — это доля тех, кто начал уровень в
          периоде и затем его завершил, поэтому она никогда не превышает 100%.
          Колонка «Без старта» — завершения уровней, которые нельзя начать
          (финансовые чекпоинты): они входят в «Завершили», но не участвуют в
          доле.
        </GrowthNote>
        {state.data.levelFunnel.steps.length === 0 ? (
          <GrowthNote>За период не было событий по уровням.</GrowthNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-xs">
              <thead className="text-text-secondary">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Уровень</th>
                  <th className="py-1.5 pr-3 font-medium">Начали</th>
                  <th className="py-1.5 pr-3 font-medium">Завершили</th>
                  <th className="py-1.5 pr-3 font-medium">Без старта</th>
                  <th className="py-1.5 font-medium">Начали → завершили</th>
                </tr>
              </thead>
              <tbody className="text-text-primary">
                {state.data.levelFunnel.steps.map((level) => (
                  <tr key={level.levelNumber} className="border-t border-border">
                    <td className="py-1.5 pr-3">L{level.levelNumber}</td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {formatCount(level.startedLearners)}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {formatCount(level.completedLearners)}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {formatCount(level.completedWithoutStartLearners)}
                    </td>
                    <td className="py-1.5 tabular-nums">
                      {formatRatio(level.startedCompletionRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GrowthSection>

      <GrowthSection title="Качество обучения">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <GrowthMetric
            label="Попыток тестов"
            value={state.data.educationQuality.assessmentsCompleted}
          />
          <GrowthMetric label="Сдано" value={state.data.educationQuality.assessmentsPassed} />
          <GrowthMetric
            label="Отчётов отправлено"
            value={state.data.educationQuality.reportsSubmitted}
          />
          <GrowthMetric
            label="Отчётов одобрено"
            value={state.data.educationQuality.reportsApproved}
          />
          <GrowthMetric
            label="На проверку ментору"
            value={state.data.educationQuality.mentorReviewsSubmitted}
          />
          <GrowthMetric
            label="Одобрено ментором"
            value={state.data.educationQuality.mentorReviewsApproved}
          />
        </div>
      </GrowthSection>

      <AvailabilityList availability={state.data.dataAvailability} />
    </div>
  );
}

function AcquisitionTab({ preset }: { preset: string }) {
  const [dimension, setDimension] = React.useState("affiliateCampaign");
  const state = useGrowthData<GrowthAcquisition>(
    (signal) => fetchGrowthAcquisition({ preset, dimension }, { signal }),
    [preset, dimension],
  );

  if (state.kind === "loading") return <LoadingBlock label="Загружаем источники…" />;
  if (state.kind === "error") {
    return <ErrorBlock message={state.message} requestId={state.requestId} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-text-secondary" htmlFor="growth-dimension">
          Разрез
        </label>
        <select
          id="growth-dimension"
          value={dimension}
          onChange={(event) => setDimension(event.target.value)}
          className="rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary"
        >
          {Object.entries(DIMENSION_LABEL).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Stated in the UI, not only in the payload. An operator who does not
          know the table is unranked will read the first row as the best one. */}
      <GrowthNote>
        Строки не ранжированы и не оцениваются. Платформа не считает сводный «показатель
        качества трафика» — сравнение делает читатель по наблюдаемым метрикам.
      </GrowthNote>

      {/* G4-R2. The cohort contract, said in the UI and not only in the payload:
          without it a reader assumes the row's registrations happened in the
          selected period, which is exactly the assumption that produced 683%. */}
      <GrowthNote>
        Таблица считается по КОГОРТЕ КЛИКОВ: знаменатель каждой строки — клики,
        совершённые в выбранном периоде, а остальные столбцы описывают, что стало
        с учащимися ИМЕННО ЭТИХ кликов — независимо от того, когда они
        зарегистрировались, активировались или внесли депозит. Поэтому ни одна
        доля не может превысить 100%.
      </GrowthNote>

      {state.data.rows.length === 0 ? (
        <GrowthNote>
          За период нет ТРЕКИНГОВЫХ источников с данными. Это таблица
          атрибутированного трафика: она пуста, когда ни одна регистрация не
          связана с кликом по трекинговой ссылке. Это не значит, что за период не
          было регистраций, активаций или депозитов — общие цифры бизнеса
          смотрите на вкладках «Обзор», «CRO-воронка» и «Pocket».
        </GrowthNote>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="text-text-secondary">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Источник</th>
                <th className="py-1.5 pr-3 font-medium">Клики периода</th>
                <th className="py-1.5 pr-3 font-medium">Рег. ATA</th>
                <th className="py-1.5 pr-3 font-medium">Активация</th>
                <th className="py-1.5 pr-3 font-medium">Рег. Pocket</th>
                <th className="py-1.5 pr-3 font-medium">Депозиты</th>
                <th className="py-1.5 pr-3 font-medium">Клик→рег.</th>
                <th className="py-1.5 font-medium">Рег.→депозит</th>
              </tr>
            </thead>
            <tbody className="text-text-primary">
              {state.data.rows.map((row, index) => (
                <tr key={`${row.dimension}-${row.label ?? index}`} className="border-t border-border">
                  <td className="py-1.5 pr-3">{row.label ?? "—"}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{formatCount(row.clicks)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{formatCount(row.registeredLearners)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{formatCount(row.activatedLearners)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">
                    {formatCount(row.pocketRegisteredLearners)}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">{formatCount(row.depositedLearners)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">
                    {formatRatio(row.attributedClickToRegistrationRate)}
                  </td>
                  <td className="py-1.5 tabular-nums">
                    {formatRatio(row.attributedRegistrationToDepositRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AvailabilityList availability={state.data.dataAvailability} />
    </div>
  );
}

function PocketTab({ preset }: { preset: string }) {
  const state = useGrowthData<GrowthPocketConversions>(
    (signal) => fetchGrowthPocketConversions({ preset }, { signal }),
    [preset],
  );

  if (state.kind === "loading") return <LoadingBlock label="Загружаем конверсии Pocket…" />;
  if (state.kind === "error") {
    return <ErrorBlock message={state.message} requestId={state.requestId} />;
  }

  return (
    <div className="space-y-5">
      {/* THREE SEPARATE FACTS, NEVER SUMMED. §42 forbids combining DEP and RDEP
          visually, and this grouping is the enforcement. */}
      <GrowthSection
        title="Подтверждённые конверсии"
        description="Регистрация Pocket не является депозитом. Первый депозит не является редепозитом."
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <GrowthMetric
            label="POCKET_REG"
            value={state.data.conversions.pocketRegistrations}
            hint="Регистрация у провайдера. Денег не несёт."
          />
          <GrowthMetric
            label="DEP"
            value={state.data.conversions.firstDeposits}
            hint="Первый депозит игрока, ровно один на игрока."
          />
          <GrowthMetric
            label="RDEP (подтверждённые)"
            value={state.data.conversions.confirmedRedeposits}
            hint="Только те, что доказуемо не являются повтором доставки."
          />
        </div>
      </GrowthSection>

      <GrowthSection title="Операционное — не деньги">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <GrowthMetric
            label="RDEP: идентичность не определена"
            value={state.data.operational.unresolvedRedeposits}
            emphasis="muted"
          />
          <GrowthNote>{GROWTH_COPY.unresolvedRedepositsMeaning}</GrowthNote>
        </div>
      </GrowthSection>

      <GrowthSection title="Суммы">
        {state.data.firstDepositAmount.amountAggregationAvailable ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <div className="rounded-md border border-border bg-surface p-3">
              <p className="text-xs text-text-secondary">Сумма первых депозитов</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-text-primary">
                {formatAmount(
                  state.data.firstDepositAmount.sum,
                  state.data.firstDepositAmount.currencyCode,
                )}
              </p>
            </div>
            <div className="rounded-md border border-border bg-surface p-3">
              <p className="text-xs text-text-secondary">Среднее</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-text-primary">
                {formatAmount(
                  state.data.firstDepositAmount.average,
                  state.data.firstDepositAmount.currencyCode,
                )}
              </p>
            </div>
            <div className="rounded-md border border-border bg-surface p-3">
              <p className="text-xs text-text-secondary">Медиана</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-text-primary">
                {formatAmount(
                  state.data.firstDepositAmount.median,
                  state.data.firstDepositAmount.currencyCode,
                )}
              </p>
            </div>
          </div>
        ) : (
          <GrowthNote>
            {amountUnavailableReason(state.data.firstDepositAmount.unavailableReason ?? "")}.
          </GrowthNote>
        )}
        <GrowthNote>{GROWTH_COPY.totalDepositAmount}</GrowthNote>
      </GrowthSection>

      <GrowthSection title="Чего здесь нет">
        <ul className="space-y-1 text-xs text-text-secondary">
          <li>Текущий баланс: не собирается платформой.</li>
          <li>P&amp;L: не собирается платформой.</li>
          <li>Комиссии и CPA: вне объёма текущей фазы.</li>
        </ul>
      </GrowthSection>

      <AvailabilityList availability={state.data.dataAvailability} />
    </div>
  );
}

function IngressTab({ preset }: { preset: string }) {
  const state = useGrowthData<GrowthIngressHealth>(
    (signal) => fetchGrowthIngressHealth({ preset }, { signal }),
    [preset],
  );

  if (state.kind === "loading") return <LoadingBlock label="Загружаем состояние приёма…" />;
  if (state.kind === "error") {
    return <ErrorBlock message={state.message} requestId={state.requestId} />;
  }

  const { switches, summary } = state.data;

  return (
    <div className="space-y-5">
      <GrowthSection
        title="Переключатели приёма"
        description="Каждое семейство событий включается отдельно. Секрет провайдера здесь не отображается ни в каком виде."
      >
        <ul className="grid grid-cols-1 gap-1.5 text-xs md:grid-cols-2">
          <SwitchRow label="Интеграция Pocket" on={switches.masterEnabled} />
          <SwitchRow label="Приём REG" on={switches.regIngestEnabled} />
          <SwitchRow label="Приём DEP" on={switches.depIngestEnabled} />
          <SwitchRow label="Приём RDEP" on={switches.rdepIngestEnabled} />
        </ul>
        {/* G4-R13-B. Both values are DOMAIN enums and neither may reach the
            operator raw. The contract state goes through its own label map and
            the reason through the same `availabilityReason()` the other four
            surfaces use — which is the point: one presentation contract, not a
            second one invented here. The API keeps its machine values. */}
        <GrowthNote>
          Контракт идентичности редепозита:{" "}
          {redepositIdentityContractLabel(switches.redepositIdentityContract)}
          {switches.redepositIdentityReason
            ? `. ${availabilityReason(switches.redepositIdentityReason)}`
            : "."}
        </GrowthNote>
      </GrowthSection>

      <GrowthSection
        title="Доставки за период"
        description={`Всего: ${formatCount(state.data.deliveries.total)}`}
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {(Object.keys(summary) as Array<keyof typeof summary>).map((key) => (
            <GrowthMetric
              key={key}
              label={INGRESS_STATUS_LABEL[key] ?? key}
              value={summary[key]}
              emphasis={summary[key] === 0 ? "muted" : "normal"}
            />
          ))}
        </div>
      </GrowthSection>

      <GrowthNote>{state.data.notes.identityUnresolved}</GrowthNote>
      <GrowthNote>{state.data.notes.authRejected}</GrowthNote>
    </div>
  );
}

function SwitchRow({ label, on }: { label: string; on: boolean }) {
  return (
    <li className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2">
      <span className="text-text-secondary">{label}</span>
      <span className={on ? "font-medium text-success" : "font-medium text-text-muted"}>
        {on ? "включено" : "выключено"}
      </span>
    </li>
  );
}
