"use client";

/**
 * AFD-5D2 — the Curie Atlas workspace.
 *
 * A RESULT IS A SNAPSHOT OF ONE RESOLVED REQUEST, held in memory only.
 *
 * This is the one place this feature deliberately departs from the AFD-5C1
 * analytics workspace, which keeps its filter state in the URL. Here the draft
 * selection is LOCAL component state, for a reason that is about honesty rather
 * than taste: an Atlas result must not be persisted, shared or restored (§6), so
 * a URL that restored the filters but never the result would advertise a
 * shareability that does not exist. Somebody pasting that link would see a
 * configured screen with no report and reasonably conclude the report had been
 * lost. Local state makes "draft" and "snapshot" two visibly different things,
 * which is exactly the distinction §6 is about.
 *
 * NOTHING RUNS BY ITSELF. There is no effect that issues the analysis. It is
 * requested only by the primary action, never on mount, never on a filter
 * change, never on a tab change, never on a timer and never on a retry loop
 * (§5). A second click while a request is in flight does nothing.
 *
 * THE SNAPSHOT IS NEVER RELABELLED. When the operator changes any analytical
 * parameter after a result exists, the result stays on screen marked STALE, over
 * its OWN resolved request — the report's `request` block, not the draft. The
 * screen therefore never shows the new filters above the old numbers, which is
 * the specific failure §6 exists to prevent.
 *
 * PERSISTENCE: NONE. No localStorage, no sessionStorage, no IndexedDB, no
 * cookie, no URL parameter, no service worker. The snapshot lives in React state
 * and dies with the component, on logout, and on losing the permission.
 *
 * THIS COMPONENT CALCULATES NOTHING. Every number, every sentence, every
 * severity and every sufficiency verdict is the backend's. The single derived
 * value is a presentation status, and it is derived only from backend-stated
 * availability facts — see `deriveResultStatus`, which documents itself.
 */
import * as React from "react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/states/empty-state";
import { AffiliateSectionTabs } from "@/features/affiliates/affiliate-section-tabs";
import { useAffiliateAccess } from "@/features/affiliates/use-affiliate-access";
import { fetchAnalyticsFilters } from "@/application/api/affiliate-analytics-client";
import type {
  AnalyticsFilterOptions,
  BreakdownDimension,
  BucketGroup,
  DatePreset,
} from "@/data/contracts/api/affiliate-analytics";
import {
  runAtlasAnalysis,
  type AtlasOutcome,
} from "@/application/api/curie-atlas-client";
import type {
  AtlasDimension,
  AtlasGroup,
  AtlasMode,
  AtlasReport,
  AtlasRequestBody,
} from "@/data/contracts/api/curie-atlas";
import { buildAtlasBody } from "@/application/api/curie-atlas-client";
import {
  CutoffControl,
  FilterControls,
  GroupSelector,
  ModeSelector,
  PeriodControls,
} from "@/features/affiliate-analytics/analytics-controls";
import {
  ErrorBlock,
  InfoNote,
  LoadingBlock,
  SectionHeading,
} from "@/features/affiliate-analytics/analytics-primitives";
import { AtlasFindingSection } from "./atlas-finding-card";
import { AtlasOverviewPanel, AtlasSufficiencyPanel } from "./atlas-overview";
import {
  ATLAS_ENGINE_NOTE,
  ATLAS_GENERIC_FAILURE,
  ATLAS_MESSAGE,
  ATLAS_MODE_BADGE,
  ATLAS_SUBTITLE,
  ATLAS_TITLE,
  CONTRACT_VIOLATION_MESSAGE,
  RUN_ACTION,
  RUN_ACTION_BUSY,
  SECTION_EMPTY,
  SECTION_HEADING,
  STALE_NOTICE,
  unresolvedDimensionLabel,
} from "./atlas-labels";

/* ------------------------------------------------------------- draft state */

/**
 * The operator's current selection.
 *
 * Deliberately a subset of `AnalyticsUrlState`: Atlas has no `coverage` and no
 * `offset`, because it publishes no breakdown page and derives its own coverage
 * from whether filters are set. Carrying fields the request cannot express would
 * suggest they do something.
 */
export interface AtlasDraft {
  mode: AtlasMode;
  preset: DatePreset;
  startDate: string | null;
  endDate: string | null;
  cutoffDate: string | null;
  group: AtlasGroup;
  dimension: AtlasDimension;
  affiliatePartnerId: string | null;
  affiliateCampaignId: string | null;
  affiliateTrackingLinkId: string | null;
}

export const ATLAS_DEFAULT_DRAFT: AtlasDraft = {
  mode: "event_date",
  preset: "last_30_days",
  startDate: null,
  endDate: null,
  cutoffDate: null,
  group: "day",
  dimension: "affiliate",
  affiliatePartnerId: null,
  affiliateCampaignId: null,
  affiliateTrackingLinkId: null,
};

/**
 * Turn a draft into the exact request body.
 *
 * A cutoff is sent ONLY in cohort mode: the backend refuses one in event-date
 * mode with `crm.analysis.cutoff_not_allowed`, and sending it would be a request
 * that always 400s. Dates are sent ONLY with the custom preset, for the same
 * reason.
 */
export function draftToBody(draft: AtlasDraft): AtlasRequestBody {
  return {
    mode: draft.mode,
    preset: draft.preset,
    startDate: draft.preset === "custom" ? (draft.startDate ?? undefined) : undefined,
    endDate: draft.preset === "custom" ? (draft.endDate ?? undefined) : undefined,
    cutoffDate:
      draft.mode === "acquisition_cohort" ? (draft.cutoffDate ?? undefined) : undefined,
    group: draft.group,
    dimension: draft.dimension,
    affiliatePartnerId: draft.affiliatePartnerId ?? undefined,
    affiliateCampaignId: draft.affiliateCampaignId ?? undefined,
    affiliateTrackingLinkId: draft.affiliateTrackingLinkId ?? undefined,
  };
}

/** The in-memory snapshot. Never serialized, never stored, never shared. */
interface AtlasSnapshot {
  report: AtlasReport;
  /** The exact body that produced it — the stale comparison key. */
  bodyKey: string;
  /** Client clock, for "when did I run this". The report carries the server's. */
  runAt: Date;
}

/* --------------------------------------------------------------- failures */

function describeFailure(outcome: AtlasOutcome): {
  message: string;
  requestId?: string;
} {
  switch (outcome.status) {
    case "success":
      return { message: "" };
    case "csrf_unavailable":
      return {
        message:
          "Не удалось получить CSRF-токен. Обновите страницу и попробуйте ещё раз.",
      };
    case "unauthenticated":
      return {
        message: "Сессия истекла. Войдите заново, чтобы выполнить анализ.",
        requestId: outcome.requestId,
      };
    case "forbidden":
      return {
        message:
          ATLAS_MESSAGE[outcome.messageKey] ??
          "Недостаточно прав для выполнения анализа.",
        requestId: outcome.requestId,
      };
    case "invalid_input":
      return {
        message: ATLAS_MESSAGE[outcome.messageKey] ?? "Бэкенд отклонил параметры анализа.",
        requestId: outcome.requestId,
      };
    case "not_found":
      return {
        message: ATLAS_MESSAGE[outcome.messageKey] ?? "Запрошенный объект не найден.",
        requestId: outcome.requestId,
      };
    case "rate_limited":
      return {
        message: "Слишком много запросов. Подождите и попробуйте ещё раз.",
        requestId: outcome.requestId,
      };
    case "timeout":
      return {
        message:
          "Анализ не завершился за отведённое время. Попробуйте сузить период или фильтры.",
      };
    case "contract_violation":
      return { message: CONTRACT_VIOLATION_MESSAGE[outcome.reason] ?? ATLAS_GENERIC_FAILURE };
    case "malformed_response":
      return { message: "Бэкенд вернул ответ, который не удалось разобрать." };
    case "cancelled":
      return { message: "" };
    case "upstream_unavailable":
    default:
      return { message: "Бэкенд недоступен. Попробуйте ещё раз." };
  }
}

/* ------------------------------------------------------------- the workspace */

export function CurieAtlasWorkspace() {
  const { canRead } = useAffiliateAccess();

  const [draft, setDraft] = React.useState<AtlasDraft>(ATLAS_DEFAULT_DRAFT);
  const [snapshot, setSnapshot] = React.useState<AtlasSnapshot | null>(null);
  const [running, setRunning] = React.useState(false);
  const [failure, setFailure] = React.useState<{ message: string; requestId?: string } | null>(
    null,
  );
  const [filterOptions, setFilterOptions] = React.useState<AnalyticsFilterOptions | null>(
    null,
  );

  // One controller for the in-flight analysis, so teardown aborts it and a
  // cancelled request is never reported as a failure.
  const inFlight = React.useRef<AbortController | null>(null);

  /* ---- permission loss and teardown clear the snapshot (§6) -------------- */

  React.useEffect(() => {
    if (!canRead) {
      setSnapshot(null);
      setFailure(null);
    }
  }, [canRead]);

  React.useEffect(() => {
    return () => {
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, []);

  /* ---- filter options: authorised inventory labels, for §11 -------------- */

  React.useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController();
    void fetchAnalyticsFilters({}, { signal: controller.signal }).then((outcome) => {
      if (outcome.status === "success") setFilterOptions(outcome.data);
    });
    return () => controller.abort();
  }, [canRead]);

  /* ---- stale detection --------------------------------------------------- */

  const draftBodyKey = React.useMemo(() => buildAtlasBody(draftToBody(draft)), [draft]);
  const stale = snapshot !== null && snapshot.bodyKey !== draftBodyKey;

  /* ---- entity label resolution (§11) ------------------------------------- */

  /**
   * Resolve a dimension member id to a human label from ALREADY-AUTHORISED
   * analytics inventory.
   *
   * It calls no lead route, no reveal API and no new backend route. When no
   * label is available it returns a bounded neutral one and never invents a
   * name — the numeric id stays in technical details, where it is a scope
   * reference rather than an identity.
   *
   * The resolver is keyed on the SNAPSHOT's dimension, not the draft's: a
   * finding belongs to the request that produced it, and resolving its scope
   * against the operator's current selection would mislabel it.
   */
  const resolveDimensionLabel = React.useCallback(
    (dimensionId: number): string | null => {
      const dimension = snapshot?.report.request.dimension;
      if (!dimension || !filterOptions) return null;
      const id = String(dimensionId);

      if (dimension === "affiliate") {
        const found = filterOptions.affiliatePartners.find((item) => item.id === id);
        return found ? found.displayName : unresolvedDimensionLabel("affiliate");
      }
      if (dimension === "campaign") {
        const found = filterOptions.affiliateCampaigns.find((item) => item.id === id);
        return found ? found.displayName : unresolvedDimensionLabel("campaign");
      }
      const found = filterOptions.affiliateTrackingLinks.find((item) => item.id === id);
      return found ? found.displayName : unresolvedDimensionLabel("tracking_link");
    },
    [filterOptions, snapshot],
  );

  /* ---- the one action ---------------------------------------------------- */

  const run = React.useCallback(async () => {
    // Duplicate execution is refused here rather than only disabled in the DOM:
    // a keyboard Enter on a focused button and a programmatic click both arrive
    // through this function.
    if (running || !canRead) return;

    const controller = new AbortController();
    inFlight.current?.abort();
    inFlight.current = controller;

    const body = draftToBody(draft);
    const bodyKey = buildAtlasBody(body);

    setRunning(true);
    setFailure(null);

    const outcome = await runAtlasAnalysis(body, { signal: controller.signal });

    if (controller.signal.aborted) return;
    inFlight.current = null;
    setRunning(false);

    if (outcome.status === "success") {
      setSnapshot({ report: outcome.data, bodyKey, runAt: new Date() });
      return;
    }
    if (outcome.status === "cancelled") return;

    // A FAILED REQUEST DOES NOT DESTROY A PREVIOUS RESULT (§16). The prior
    // snapshot stays, marked stale by the same rule as any other parameter
    // change, and the failure is reported separately above it.
    setFailure(describeFailure(outcome));
  }, [canRead, draft, running]);

  /* ---- denied ------------------------------------------------------------ */

  if (!canRead) {
    return (
      <div className="space-y-4">
        <PageHeader title={ATLAS_TITLE} />
        <EmptyState
          title="Недостаточно прав"
          description="Для просмотра Curie Atlas нужно право view_affiliate_analytics или manage_settings."
        />
      </div>
    );
  }

  const report = snapshot?.report ?? null;
  const eventMode = draft.mode === "event_date";

  return (
    <div className="space-y-5">
      <PageHeader title={ATLAS_TITLE} description={ATLAS_SUBTITLE} />
      <AffiliateSectionTabs active="atlas" />

      {/* The honesty badge. Backed by the parsed response, not by a promise. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full border border-border bg-elevated px-2.5 py-0.5 text-xs font-medium text-text-primary">
          {ATLAS_MODE_BADGE}
        </span>
        <span className="text-xs text-text-secondary">Детерминированный движок · Curie Atlas 1.0.0</span>
      </div>
      <InfoNote>{ATLAS_ENGINE_NOTE}</InfoNote>

      {/* ------------------------------------------------------- controls */}

      <section
        aria-labelledby="atlas-controls"
        className="space-y-4 rounded-md border border-border bg-surface p-2 sm:p-4"
      >
        <SectionHeading id="atlas-controls" title="Параметры анализа" level={2} />

        <ModeSelector
          mode={draft.mode}
          onChange={(mode) => setDraft((prev) => ({ ...prev, mode: mode as AtlasMode }))}
        />

        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <PeriodControls
            preset={draft.preset}
            startDate={draft.startDate}
            endDate={draft.endDate}
            // The resolved period belongs to the SNAPSHOT, not the draft: only a
            // completed run has one, and showing the previous run's resolution
            // beside a changed draft would be the relabelling §6 forbids.
            resolvedPeriod={null}
            disabled={running}
            onChange={(change) =>
              setDraft((prev) => ({
                ...prev,
                preset: change.preset,
                startDate: change.startDate,
                endDate: change.endDate,
              }))
            }
          />
          <div className="min-w-0 space-y-3">
            <GroupSelector
              group={draft.group as BucketGroup}
              disabled={running}
              onChange={(group) =>
                setDraft((prev) => ({ ...prev, group: group as AtlasGroup }))
              }
            />
            {!eventMode ? (
              <CutoffControl
                cutoffDate={draft.cutoffDate}
                reportCutoff={null}
                disabled={running}
                onChange={(cutoffDate) => setDraft((prev) => ({ ...prev, cutoffDate }))}
              />
            ) : null}
          </div>
        </div>

        <FilterControls
          options={filterOptions}
          disabled={running}
          state={{
            mode: draft.mode,
            preset: draft.preset,
            startDate: draft.startDate,
            endDate: draft.endDate,
            cutoffDate: draft.cutoffDate,
            group: draft.group as BucketGroup,
            affiliatePartnerId: draft.affiliatePartnerId,
            affiliateCampaignId: draft.affiliateCampaignId,
            affiliateTrackingLinkId: draft.affiliateTrackingLinkId,
            dimension: draft.dimension as BreakdownDimension,
            coverage: "total",
            offset: 0,
          }}
          onChange={(change) =>
            setDraft((prev) => ({
              ...prev,
              ...(change.affiliatePartnerId !== undefined
                ? { affiliatePartnerId: change.affiliatePartnerId }
                : {}),
              ...(change.affiliateCampaignId !== undefined
                ? { affiliateCampaignId: change.affiliateCampaignId }
                : {}),
              ...(change.affiliateTrackingLinkId !== undefined
                ? { affiliateTrackingLinkId: change.affiliateTrackingLinkId }
                : {}),
              ...(change.dimension !== undefined
                ? { dimension: change.dimension as AtlasDimension }
                : {}),
            }))
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void run()}
            disabled={running}
            aria-busy={running}
            data-testid="atlas-run"
            className="rounded-md border border-accent bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {running ? RUN_ACTION_BUSY : RUN_ACTION}
          </button>
          {stale ? (
            <span className="text-xs text-text-secondary">{STALE_NOTICE}</span>
          ) : null}
        </div>
      </section>

      {/* Announced to assistive technology without stealing focus (§17). */}
      <p className="sr-only" role="status" aria-live="polite">
        {running
          ? "Анализ выполняется"
          : report === null
            ? "Анализ ещё не запускался"
            : stale
              ? "Параметры изменились, показан предыдущий результат"
              : "Анализ готов"}
      </p>

      {/* ---------------------------------------------------------- states */}

      {failure && failure.message !== "" ? (
        <div data-testid="atlas-error">
          <ErrorBlock
            message={failure.message}
            requestId={failure.requestId}
            onRetry={() => void run()}
          />
        </div>
      ) : null}

      {running && report === null ? <LoadingBlock label="Выполняем анализ…" /> : null}

      {report === null && !running ? (
        <EmptyState
          title="Анализ ещё не запускался"
          description="Задайте параметры и нажмите «Запустить анализ». Curie Atlas ничего не считает, пока вы об этом не попросите."
        />
      ) : null}

      {report !== null ? (
        <div className="space-y-5">
          {stale ? (
            <InfoNote tone="warning">
              <strong className="font-medium">{STALE_NOTICE}</strong>{" "}
              Ниже — результат предыдущего запуска. Он описывает свои собственные
              параметры, показанные в блоке «Обзор», а не текущий выбор.
            </InfoNote>
          ) : null}

          <div
            // Dimmed and marked, but never hidden: a stale result is still the
            // last true answer, and removing it would lose information.
            className={stale ? "opacity-75" : undefined}
            data-testid="atlas-result"
            data-stale={stale ? "true" : "false"}
          >
            <AtlasOverviewPanel
              report={report}
              runAt={snapshot?.runAt ?? null}
              stale={stale}
              resolveDimensionLabel={resolveDimensionLabel}
            />

            <div className="mt-5 space-y-5">
              <AtlasSufficiencyPanel report={report} />

              <AtlasFindingSection
                id="atlas-warnings"
                heading={SECTION_HEADING.warning}
                emptyText={SECTION_EMPTY.warning}
                findings={report.warnings}
                resolveDimensionLabel={resolveDimensionLabel}
              />
              <AtlasFindingSection
                id="atlas-observations"
                heading={SECTION_HEADING.observation}
                emptyText={SECTION_EMPTY.observation}
                findings={report.observations}
                resolveDimensionLabel={resolveDimensionLabel}
              />
              <AtlasFindingSection
                id="atlas-positive-signals"
                heading={SECTION_HEADING.positive_signal}
                emptyText={SECTION_EMPTY.positive_signal}
                findings={report.positiveSignals}
                resolveDimensionLabel={resolveDimensionLabel}
              />
              <AtlasFindingSection
                id="atlas-questions"
                heading={SECTION_HEADING.question}
                emptyText={SECTION_EMPTY.question}
                findings={report.questions}
                resolveDimensionLabel={resolveDimensionLabel}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
