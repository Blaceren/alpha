"use client";

/**
 * AFD-5C1 — the affiliate / campaign / tracking-link breakdown.
 *
 * ONE ROW PER DIMENSION MEMBER, NEVER PER LEARNER. There is no lead identity
 * here, no email, no Pocket id and no click id — the response type this
 * component accepts has no field to put one in, and the lead API is not even
 * reachable through the CRM origin.
 *
 * THE TOTAL IS THE BACKEND'S, NOT THE PAGE'S. `attributedTotals` /
 * `cohortTotals` describe the WHOLE filtered result set and are displayed as
 * such. This component never sums the rows it can see: page 2 of a 3-page
 * breakdown would otherwise report a third of the traffic as the total, and it
 * would look entirely plausible.
 *
 * RESPONSIVE BY DUPLICATION, NOT BY HIDING. Below `md` the same rows render as
 * cards; the table is not merely scrolled off-screen, and no column is dropped,
 * so a phone shows the same facts a desktop does.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import type {
  AmountAvailability,
  BreakdownDimension,
  BreakdownRow,
  CohortBreakdownRow,
} from "@/data/contracts/api/affiliate-analytics";
import {
  AMOUNT_TITLE,
  amountUnavailableReason,
  COHORT_METRIC_LABEL,
  formatAmount,
  formatCount,
  formatRatio,
  METRIC_LABEL,
} from "./analytics-labels";

export const DIMENSION_LABEL: Record<BreakdownDimension, string> = {
  affiliate: "Аффилейты",
  campaign: "Кампании",
  tracking_link: "Ссылки",
};

/* -------------------------------------------------------------- shared UI */

export function DimensionSelector({
  dimension,
  onChange,
  disabled,
}: {
  dimension: BreakdownDimension;
  onChange: (dimension: BreakdownDimension) => void;
  disabled?: boolean;
}) {
  const dimensions: BreakdownDimension[] = ["affiliate", "campaign", "tracking_link"];
  return (
    <div
      role="radiogroup"
      aria-label="Разрез детализации"
      className="inline-flex flex-wrap gap-1 rounded-md border border-border bg-elevated p-1"
    >
      {dimensions.map((option) => {
        const selected = option === dimension;
        return (
          <label
            key={option}
            className={cn(
              "cursor-pointer rounded px-2.5 py-1 text-xs",
              selected
                ? "bg-surface font-medium text-text-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary",
            )}
          >
            <input
              type="radio"
              name="analytics-dimension"
              className="sr-only"
              value={option}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(option)}
            />
            {DIMENSION_LABEL[option]}
          </label>
        );
      })}
    </div>
  );
}

/** Name, immutable code and stored status — the row's identity column. */
function RowIdentity({
  displayName,
  code,
  status,
  archived,
}: {
  displayName: string | null;
  code: string | null;
  status: string | null;
  archived: boolean;
}) {
  return (
    <span className="block min-w-0">
      <span className="block truncate font-medium text-text-primary">
        {displayName ?? "Без названия"}
      </span>
      <span className="mt-0.5 block truncate text-[11px] text-text-muted">
        {code ?? "—"}
        {/* Archived state is a WORD, not a shade: §36 forbids status by colour. */}
        {archived ? " · в архиве" : status === "paused" ? " · на паузе" : status === "draft" ? " · черновик" : ""}
      </span>
    </span>
  );
}

function AmountCell({ amount }: { amount: AmountAvailability }) {
  // Narrowed on the DISCRIMINANT, not on the formatted string: only this branch
  // has an amount and a currency at all, so there is no path that renders one
  // without the other.
  if (amount.amountAggregationAvailable) {
    return <span className="tabular-nums">{formatAmount(amount)}</span>;
  }
  return (
    <span className="text-[11px] text-text-muted" title={amountUnavailableReason(amount.unavailableReason)}>
      Недоступно
    </span>
  );
}

export function Pagination({
  total,
  limit,
  offset,
  onOffsetChange,
  disabled,
}: {
  total: number;
  limit: number;
  offset: number;
  onOffsetChange: (offset: number) => void;
  disabled?: boolean;
}) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
      <p aria-live="polite">
        {/* The backend's `total`, never the number of rows on screen. */}
        {from}–{to} из {formatCount(total)}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled || offset === 0}
          onClick={() => onOffsetChange(Math.max(offset - limit, 0))}
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
        >
          Назад
        </button>
        <button
          type="button"
          disabled={disabled || to >= total}
          onClick={() => onOffsetChange(offset + limit)}
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
        >
          Вперёд
        </button>
      </div>
    </div>
  );
}

function LastActivity({ value }: { value: string | null }) {
  if (value === null) return <span className="text-text-muted">—</span>;
  // Rendered from the ISO instant the backend sent, with no re-derivation of a
  // business day: the exact wall-clock date belongs to the period contract.
  const date = new Date(value);
  return (
    <time dateTime={value} className="tabular-nums text-[11px] text-text-secondary">
      {date.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}
    </time>
  );
}

/* ------------------------------------------------------- event-date table */

const EVENT_COLUMNS = [
  { key: "qualifiedClicks", label: METRIC_LABEL.qualifiedClicks },
  { key: "uniqueVisitors", label: METRIC_LABEL.uniqueVisitors },
  { key: "academyRegistrations", label: METRIC_LABEL.academyRegistrations },
  { key: "pocketRegistrations", label: METRIC_LABEL.pocketRegistrations },
  { key: "confirmedFirstDeposits", label: METRIC_LABEL.confirmedFirstDeposits },
] as const;

export function EventDateBreakdownTable({ rows }: { rows: readonly BreakdownRow[] }) {
  return (
    <>
      {/* Desktop */}
      <div className="hidden overflow-x-auto rounded-md border border-border md:block">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <caption className="sr-only">Детализация по дате события</caption>
          <thead>
            <tr className="border-b border-border bg-elevated text-xs">
              <th scope="col" className="px-3 py-2 text-left font-medium text-text-secondary">
                Название
              </th>
              {EVENT_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className="px-3 py-2 text-right font-medium text-text-secondary"
                >
                  {column.label}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right font-medium text-text-secondary">
                Клик → FD
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium text-text-secondary">
                {AMOUNT_TITLE}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium text-text-secondary">
                Последняя активность
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0 hover:bg-row-hover">
                <th scope="row" className="max-w-[220px] px-3 py-2 text-left font-normal">
                  <RowIdentity
                    displayName={row.displayName}
                    code={row.code}
                    status={row.status}
                    archived={row.archived}
                  />
                </th>
                {EVENT_COLUMNS.map((column) => (
                  <td key={column.key} className="px-3 py-2 text-right tabular-nums">
                    {formatCount(row.metrics[column.key])}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatRatio(row.ratios.qualifiedClickToFirstDepositRate)}
                </td>
                <td className="px-3 py-2 text-right">
                  <AmountCell amount={row.firstDepositAmount} />
                </td>
                <td className="px-3 py-2 text-right">
                  <LastActivity value={row.lastActivityAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul className="space-y-2 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="rounded-md border border-border bg-surface p-3">
            <RowIdentity
              displayName={row.displayName}
              code={row.code}
              status={row.status}
              archived={row.archived}
            />
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              {EVENT_COLUMNS.map((column) => (
                <div key={column.key} className="flex justify-between gap-2">
                  <dt className="min-w-0 truncate text-text-secondary">{column.label}</dt>
                  <dd className="shrink-0 tabular-nums text-text-primary">
                    {formatCount(row.metrics[column.key])}
                  </dd>
                </div>
              ))}
              <div className="flex justify-between gap-2">
                <dt className="text-text-secondary">Клик → FD</dt>
                <dd className="shrink-0 tabular-nums text-text-primary">
                  {formatRatio(row.ratios.qualifiedClickToFirstDepositRate)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="min-w-0 truncate text-text-secondary">{AMOUNT_TITLE}</dt>
                <dd className="shrink-0 text-text-primary">
                  <AmountCell amount={row.firstDepositAmount} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ----------------------------------------------------------- cohort table */

export function CohortBreakdownTable({ rows }: { rows: readonly CohortBreakdownRow[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-md border border-border md:block">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <caption className="sr-only">Детализация по когорте привлечения</caption>
          <thead>
            <tr className="border-b border-border bg-elevated text-xs">
              <th scope="col" className="px-3 py-2 text-left font-medium text-text-secondary">
                Название
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium text-text-secondary">
                {COHORT_METRIC_LABEL.cohortLearners}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium text-text-secondary">
                {COHORT_METRIC_LABEL.pocketRegisteredLearners}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium text-text-secondary">
                {COHORT_METRIC_LABEL.firstDepositLearners}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium text-text-secondary">
                Доля Pocket
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium text-text-secondary">
                Доля FD
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium text-text-secondary">
                {AMOUNT_TITLE}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0 hover:bg-row-hover">
                <th scope="row" className="max-w-[220px] px-3 py-2 text-left font-normal">
                  <RowIdentity
                    displayName={row.displayName}
                    code={row.code}
                    status={row.status}
                    archived={row.archived}
                  />
                </th>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCount(row.metrics.cohortLearners)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCount(row.metrics.pocketRegisteredLearners)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCount(row.metrics.firstDepositLearners)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatRatio(row.rates.pocketRegistrationRate)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatRatio(row.rates.firstDepositRate)}
                </td>
                <td className="px-3 py-2 text-right">
                  <AmountCell amount={row.firstDepositAmount} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="rounded-md border border-border bg-surface p-3">
            <RowIdentity
              displayName={row.displayName}
              code={row.code}
              status={row.status}
              archived={row.archived}
            />
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="min-w-0 truncate text-text-secondary">
                  {COHORT_METRIC_LABEL.cohortLearners}
                </dt>
                <dd className="shrink-0 tabular-nums text-text-primary">
                  {formatCount(row.metrics.cohortLearners)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="min-w-0 truncate text-text-secondary">Pocket</dt>
                <dd className="shrink-0 tabular-nums text-text-primary">
                  {formatCount(row.metrics.pocketRegisteredLearners)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="min-w-0 truncate text-text-secondary">FD</dt>
                <dd className="shrink-0 tabular-nums text-text-primary">
                  {formatCount(row.metrics.firstDepositLearners)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-text-secondary">Доля FD</dt>
                <dd className="shrink-0 tabular-nums text-text-primary">
                  {formatRatio(row.rates.firstDepositRate)}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
