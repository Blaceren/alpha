"use client";

/**
 * AFD-5C1 — the small display pieces the analytics workspace is built from.
 *
 * The rule these all share: AN ABSENCE IS RENDERED AS AN ABSENCE. `MetricCard`
 * takes a number and shows it, including a real 0. `RatioCard` takes an exact
 * decimal string OR null and shows "Недостаточно данных" for the null — it has
 * no code path that produces "0 %" from one. `AvailabilityList` renders an
 * unavailable capability as a NAMED REASON and never as a metric tile, because a
 * tile is a place a reader expects to find a number.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import type { AvailabilityState } from "@/data/contracts/api/affiliate-analytics";
import {
  CAPABILITY_LABEL,
  formatCount,
  formatRatio,
  INSUFFICIENT_DATA,
  isRatioUnavailable,
  unavailableReasonLabel,
} from "./analytics-labels";

/* -------------------------------------------------------------- section UI */

export function SectionHeading({
  title,
  description,
  level = 2,
  actions,
  id,
}: {
  title: string;
  description?: React.ReactNode;
  level?: 2 | 3;
  actions?: React.ReactNode;
  id?: string;
}) {
  const Tag = (level === 2 ? "h2" : "h3") as "h2" | "h3";
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <Tag id={id} className={cn("font-semibold text-text-primary", level === 2 ? "text-base" : "text-sm")}>
          {title}
        </Tag>
        {description ? (
          <p className="mt-0.5 max-w-3xl break-words text-xs leading-relaxed text-text-secondary">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * A short explanatory note.
 *
 * Rendered as ordinary visible text rather than behind a tooltip: §17 and §18
 * require the semantics of each mode to remain visible, and a caveat that has to
 * be hovered to be found is a caveat most readers never see.
 */
export function InfoNote({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warning";
  className?: string;
}) {
  return (
    <p
      className={cn(
        "rounded-md border px-3 py-2 text-xs leading-relaxed break-words",
        tone === "warning"
          ? "border-warning/40 bg-warning/10 text-text-primary"
          : "border-border bg-elevated text-text-secondary",
        className,
      )}
    >
      {children}
    </p>
  );
}

/* ------------------------------------------------------------ metric cards */

export function MetricCard({
  label,
  value,
  hint,
  emphasis = "normal",
}: {
  label: string;
  value: number;
  hint?: string;
  emphasis?: "normal" | "muted";
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border p-3",
        emphasis === "muted" ? "bg-elevated" : "bg-surface",
      )}
    >
      <p className="break-words text-xs leading-snug text-text-secondary">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-text-primary">
        {formatCount(value)}
      </p>
      {hint ? <p className="mt-1 break-words text-[11px] leading-snug text-text-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * A ratio, with its denominator named.
 *
 * THE DENOMINATOR IS ALWAYS SHOWN. "Клик → регистрация 4,2 %" is ambiguous until
 * the reader knows the denominator is qualified clicks and not raw ones, and the
 * backend publishes `ratioDenominators` precisely so a client does not have to
 * guess. The unavailable state is styled DIFFERENTLY from a real value, not just
 * worded differently, so it cannot be skimmed as a number.
 */
export function RatioCard({
  label,
  value,
  denominatorLabel,
  semanticsNote,
}: {
  label: string;
  value: string | null;
  denominatorLabel?: string;
  semanticsNote?: string;
}) {
  const unavailable = isRatioUnavailable(value);
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <p className="break-words text-xs leading-snug text-text-secondary">{label}</p>
      <p
        className={cn(
          "mt-1 font-semibold tabular-nums",
          unavailable ? "text-sm text-text-muted" : "text-xl text-text-primary",
        )}
      >
        {formatRatio(value)}
      </p>
      {denominatorLabel ? (
        <p className="mt-1 text-[11px] leading-snug text-text-muted">
          Знаменатель: {denominatorLabel}
        </p>
      ) : null}
      {semanticsNote ? (
        <p className="mt-0.5 text-[11px] leading-snug text-text-muted">{semanticsNote}</p>
      ) : null}
      {unavailable ? (
        <span className="sr-only">
          {INSUFFICIENT_DATA}: знаменатель равен нулю. Это не ноль процентов.
        </span>
      ) : null}
    </div>
  );
}

/**
 * A median lag: formatted duration, exact source value, and sample size.
 *
 * The sample size is ALWAYS visible (§27). A median over two observations and a
 * median over two thousand look identical without it, and only one of them is
 * worth acting on.
 */
export function MedianCard({
  label,
  display,
  exact,
  sampleSize,
  sampleLabel,
  negativeDurationCount,
}: {
  label: string;
  display: string | null;
  exact: string | null;
  sampleSize: number;
  sampleLabel: string;
  negativeDurationCount: number;
}) {
  const unavailable = display === null || sampleSize === 0;
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <p className="break-words text-xs leading-snug text-text-secondary">{label}</p>
      {unavailable ? (
        <p className="mt-1 text-sm font-semibold text-text-muted">Нет наблюдений</p>
      ) : (
        <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
          {display}
          {/* The untouched backend value, for anybody who needs the exact
              number rather than the readable one. */}
          {exact ? <span className="sr-only"> (точно: {exact})</span> : null}
        </p>
      )}
      <p className="mt-1 text-[11px] leading-snug text-text-muted">
        {sampleLabel}
        {exact && !unavailable ? ` · точно ${exact}` : ""}
      </p>
      {negativeDurationCount > 0 ? (
        <p className="mt-0.5 text-[11px] leading-snug text-warning">
          Исключено записей с отрицательной длительностью: {formatCount(negativeDurationCount)}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ availability */

/**
 * The "Доступность данных" section.
 *
 * Deliberately a definition list rather than a grid of cards: an unavailable
 * capability has no value, and putting it in a card shaped like a metric tile is
 * how "0 повторных депозитов" gets read as a business fact. Available
 * capabilities are listed too, because the section answers "what can this
 * deployment measure" and a list of only the gaps does not.
 */
export function AvailabilityList({
  entries,
  overrides,
}: {
  entries: Readonly<Record<string, AvailabilityState>>;
  overrides?: Readonly<Record<string, string>>;
}) {
  const items = Object.entries(entries);
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {items.map(([key, state]) => {
        const override = overrides?.[key];
        const available = state.available;
        return (
          // STACKED, not a two-column row. The unavailable reasons are whole
          // sentences ("Pocket не передаёт идентификатор транзакции, поэтому…"),
          // and side-by-side they squeezed the capability NAME to zero width —
          // the label vanished while the explanation remained, which is exactly
          // backwards. Stacking keeps both readable at every width.
          <div key={key} className="border-b border-border/60 pb-1.5">
            <dt className="break-words text-xs font-medium text-text-secondary">
              {CAPABILITY_LABEL[key] ?? key}
            </dt>
            <dd
              className={cn(
                "mt-0.5 break-words text-[11px] leading-snug",
                available && !override ? "text-success" : "text-text-muted",
              )}
            >
              {/* Status is never colour-only: the word itself carries it. */}
              {override ?? (available ? "Доступно" : unavailableReasonLabel(state.reason))}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/* ------------------------------------------------------------ states */

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-md border border-border bg-surface p-6 text-center text-sm text-text-secondary"
    >
      {label}
    </div>
  );
}

export function ErrorBlock({
  message,
  requestId,
  onRetry,
}: {
  message: string;
  requestId?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-text-primary"
    >
      <p>{message}</p>
      {requestId ? (
        <p className="mt-1 text-[11px] text-text-muted">Идентификатор запроса: {requestId}</p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Повторить
        </button>
      ) : null}
    </div>
  );
}

/** Marks a section whose visible data belongs to the previous filter state. */
export function RefreshingBadge() {
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1 rounded-full border border-border bg-elevated px-2 py-0.5 text-[11px] text-text-secondary"
    >
      Обновляется…
    </span>
  );
}
