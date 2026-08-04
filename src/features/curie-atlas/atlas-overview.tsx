"use client";

/**
 * AFD-5D2 — the Обзор and Достаточность данных panels.
 *
 * THE OVERVIEW DESCRIBES THE REPORT'S OWN REQUEST, never the operator's current
 * selection. Everything here reads `report.request` and `report.overview`, so a
 * stale snapshot on screen is labelled with the parameters that produced it —
 * which is the whole point of §6.
 *
 * WHAT IS NOT SHOWN BY DEFAULT (§8): the input fingerprint and the request id.
 * Both are diagnostics, not report content. They live inside the technical
 * details disclosure, where an operator can copy them into a ticket, and they
 * never reach the URL.
 *
 * IDS ARE NOT NAMES. An active filter is displayed through its resolved
 * inventory label when one is authorised and available; otherwise a bounded
 * neutral label. The raw id appears only in technical details, as a scope
 * reference (§11).
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import type { AtlasReport } from "@/data/contracts/api/curie-atlas";
import { SectionHeading } from "@/features/affiliate-analytics/analytics-primitives";
import type { DimensionLabelResolver } from "./atlas-finding-card";
import {
  ATLAS_MODE_BADGE,
  BACKEND_SUFFICIENCY_LABEL,
  COVERAGE_LABEL,
  DIMENSION_LABEL,
  GROUP_LABEL,
  MODE_LABEL,
  OVERVIEW_HEADING,
  RESULT_STATUS_LABEL,
  RESULT_STATUS_NOTE,
  SUFFICIENCY_HEADING,
  TECHNICAL_DETAILS,
  adjustmentHintFor,
  deriveResultStatus,
  headlineMetricLabel,
  insufficiencyReasonLabel,
  isKnownInsufficiencyReason,
} from "./atlas-labels";

/* ------------------------------------------------------------------ helpers */

/** A definition row. `<dl>` keeps the label/value association on any width. */
function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-text-secondary">{term}</dt>
      <dd className="min-w-0 break-words text-text-primary">{children}</dd>
    </>
  );
}

/** Formats an ISO instant through the operator's locale, or returns it raw. */
function formatInstant(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
}

/* ----------------------------------------------------------------- overview */

export function AtlasOverviewPanel({
  report,
  runAt,
  stale,
  resolveDimensionLabel,
}: {
  report: AtlasReport;
  runAt: Date | null;
  stale: boolean;
  resolveDimensionLabel?: DimensionLabelResolver;
}) {
  const status = deriveResultStatus(report);
  const { request, overview } = report;

  /**
   * Active filters in redacted operational form (§8).
   *
   * A filter is named by its resolved label when one is available. The id is
   * NOT printed here — it is a database key, and §8 forbids exposing one where a
   * human-readable label exists. When no label resolves, the neutral fallback
   * from the resolver is used, so the operator learns a filter is active without
   * being handed an internal identifier as if it were a name.
   */
  const activeFilters: string[] = [];
  if (request.filters.affiliatePartnerId !== null) {
    activeFilters.push(
      `${DIMENSION_LABEL.affiliate}: ${
        resolveDimensionLabel?.(Number(request.filters.affiliatePartnerId)) ?? "—"
      }`,
    );
  }
  if (request.filters.affiliateCampaignId !== null) {
    activeFilters.push(`${DIMENSION_LABEL.campaign}: выбрана`);
  }
  if (request.filters.affiliateTrackingLinkId !== null) {
    activeFilters.push(`${DIMENSION_LABEL.tracking_link}: выбрана`);
  }

  return (
    <section
      aria-labelledby="atlas-overview"
      className="space-y-3 rounded-md border border-border bg-surface p-3 sm:p-4"
    >
      <SectionHeading
        id="atlas-overview"
        title={OVERVIEW_HEADING}
        level={3}
        actions={
          <span
            data-testid="atlas-result-status"
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
              status === "insufficient_data"
                ? "border-warning/50 bg-warning/10 text-text-primary"
                : status === "partial"
                  ? "border-warning/40 bg-warning/5 text-text-primary"
                  : "border-border bg-elevated text-text-primary",
            )}
          >
            {RESULT_STATUS_LABEL[status]}
          </span>
        }
      />

      {stale ? (
        <p className="text-xs text-text-secondary">
          Параметры ниже принадлежат этому результату, а не текущему выбору.
        </p>
      ) : null}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-[auto_1fr]">
        <Row term="Агент">Curie Atlas</Row>
        <Row term="Версия контракта">{report.agent.version}</Row>
        <Row term="Движок">Детерминированный · {ATLAS_MODE_BADGE}</Row>
        <Row term="Модель вызывалась">
          {/* The literal false from the parsed contract. */}
          {report.engine.modelInvoked ? "да" : "нет"}
        </Row>
        <Row term="Режим">{MODE_LABEL[request.mode]}</Row>
        <Row term="Период">
          {request.period.startLocal ?? "—"} — {request.period.endLocal}
          <span className="ml-1 text-text-muted">({request.period.timezone})</span>
        </Row>
        <Row term="Пресет периода">{request.period.resolvedPreset}</Row>
        {request.cutoff ? (
          <Row term="Отсечка наблюдения">
            {/* Null when the cutoff is the report clock rather than a date the
                operator chose; the resolved local timestamp is then the honest
                thing to show, and it is still the backend's own value. */}
            {request.cutoff.cutoffDateLocal ?? request.cutoff.cutoffLocal}
            {request.cutoff.clampedToReportClock ? (
              <span className="ml-1 text-text-muted">(ограничена часами отчёта)</span>
            ) : null}
          </Row>
        ) : null}
        <Row term="Группировка">{GROUP_LABEL[request.group]}</Row>
        <Row term="Разрез">{DIMENSION_LABEL[request.dimension]}</Row>
        <Row term="Охват">{COVERAGE_LABEL[overview.coverage]}</Row>
        <Row term="Фильтры">
          {activeFilters.length === 0 ? "не заданы" : activeFilters.join(" · ")}
        </Row>
        <Row term="Интервалов в периоде">{overview.bucketCount}</Row>
        <Row term="Отчёт построен">{formatInstant(report.generatedAt)}</Row>
        {runAt ? (
          <Row term="Запрошено из CRM">
            {runAt.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })}
          </Row>
        ) : null}
      </dl>

      {/* Headline metrics, exactly as published. No client arithmetic. */}
      <div>
        <h4 className="text-xs font-medium text-text-secondary">Ключевые показатели</h4>
        <dl className="mt-1.5 grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-[auto_1fr]">
          {Object.entries(overview.headlineMetrics).map(([key, value]) => (
            <Row key={key} term={headlineMetricLabel(key)}>
              <span className="tabular-nums">{value}</span>
            </Row>
          ))}
        </dl>
      </div>

      <p className="text-xs text-text-secondary">
        Найдено: предупреждений {overview.findingCounts.warning}, наблюдений{" "}
        {overview.findingCounts.observation}, положительных сигналов{" "}
        {overview.findingCounts.positive_signal}, вопросов{" "}
        {overview.findingCounts.question}.
      </p>

      {/* Diagnostics: never in the URL, never shown by default (§8). */}
      <details>
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-[11px] text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          {TECHNICAL_DETAILS}
        </summary>
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-text-secondary">
          <dt>Отпечаток запроса</dt>
          <dd className="break-all font-mono text-text-primary">{report.inputFingerprint}</dd>
          <dt>Идентификатор запроса</dt>
          <dd className="break-all font-mono text-text-primary">{report.requestId}</dd>
          <dt>Версия движка</dt>
          <dd className="font-mono">{report.engine.engineVersion}</dd>
          <dt>Версия каталога</dt>
          <dd className="font-mono">{report.engine.catalogVersion}</dd>
          <dt>Статус бэкенда</dt>
          <dd className="font-mono">
            {BACKEND_SUFFICIENCY_LABEL[report.dataSufficiency.status] ??
              report.dataSufficiency.status}
          </dd>
          {request.filters.affiliatePartnerId ? (
            <>
              <dt>Фильтр: аффилейт</dt>
              <dd className="font-mono">{request.filters.affiliatePartnerId}</dd>
            </>
          ) : null}
          {request.filters.affiliateCampaignId ? (
            <>
              <dt>Фильтр: кампания</dt>
              <dd className="font-mono">{request.filters.affiliateCampaignId}</dd>
            </>
          ) : null}
          {request.filters.affiliateTrackingLinkId ? (
            <>
              <dt>Фильтр: ссылка</dt>
              <dd className="font-mono">{request.filters.affiliateTrackingLinkId}</dd>
            </>
          ) : null}
        </dl>
      </details>
    </section>
  );
}

/* --------------------------------------------------------------- sufficiency */

export function AtlasSufficiencyPanel({ report }: { report: AtlasReport }) {
  const status = deriveResultStatus(report);
  const sufficiency = report.dataSufficiency;

  return (
    <section
      aria-labelledby="atlas-sufficiency"
      className="space-y-2 rounded-md border border-border bg-surface p-3"
    >
      <h3 id="atlas-sufficiency" className="text-sm font-semibold text-text-primary">
        {SUFFICIENCY_HEADING}
      </h3>

      <p className="text-xs leading-relaxed text-text-secondary">
        {RESULT_STATUS_NOTE[status]}
      </p>

      {sufficiency.status === "insufficient_data" ? (
        <div className="space-y-2">
          <p
            data-testid="atlas-insufficient-reason"
            className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-text-primary"
          >
            {insufficiencyReasonLabel(sufficiency.reason)}
          </p>

          {/* A neutral hint ONLY when the returned reason supports it (§12). */}
          {adjustmentHintFor(sufficiency.reason) ? (
            <p className="text-xs text-text-secondary">
              {adjustmentHintFor(sufficiency.reason)}
            </p>
          ) : null}

          {sufficiency.evidence.length > 0 ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-text-secondary">
              {sufficiency.evidence.map((item, index) => (
                <React.Fragment key={`${item.key}-${index}`}>
                  <dt>{item.key}</dt>
                  <dd className="tabular-nums text-text-primary">{item.value}</dd>
                </React.Fragment>
              ))}
            </dl>
          ) : null}

          {/* An unknown code is reported to diagnostics without crashing (§12). */}
          {!isKnownInsufficiencyReason(sufficiency.reason) ? (
            <details>
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-[11px] text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                {TECHNICAL_DETAILS}
              </summary>
              <p className="mt-1 break-all font-mono text-[11px] text-text-primary">
                {sufficiency.reason}
              </p>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
