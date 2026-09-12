"use client";

/**
 * AFD-5C1 — the analytics column chart.
 *
 * WHY THIS IS HAND-WRITTEN RATHER THAN A DEPENDENCY. The CRM dependency graph
 * contains no charting owner and no design-system visualisation primitive (§31),
 * and the requirement here is one column chart. Adding a dashboard library to
 * draw it would import a large surface — and its own accessibility model — for a
 * single component, so this is a narrow SVG chart built from the existing design
 * tokens instead.
 *
 * WHAT THE CHART IS NOT ALLOWED TO DO, enforced by construction:
 *
 *   * NO REGROUPING. `buckets` is rendered in the exact order the backend
 *     returned it, one column per bucket, using the backend's own `localLabel`.
 *     There is no client-side bucketing, sorting, merging or resampling — the
 *     component never sees a date, only a label and a set of numbers.
 *
 *   * NO INTERPOLATION. Columns, not a line: a line between two buckets draws a
 *     value at every pixel between them that no bucket reported. A zero bucket
 *     therefore renders as a visible baseline tick rather than as a gap, because
 *     "no traffic on Tuesday" is a fact about Tuesday.
 *
 *   * NO TRUNCATION. Every bucket handed in is drawn. When there are more
 *     buckets than pixels the chart scrolls horizontally inside its own
 *     container; it never silently drops the left-hand side.
 *
 *   * NO MIXED SCALES. One chart renders ONE kind — counts or rates, never both.
 *     `kind` picks the axis formatting and the axis is always labelled. Counts
 *     and percentages on one unlabelled axis is the classic way to make a 3 %
 *     conversion rate look like it dwarfs 3 000 clicks.
 *
 * ACCESSIBILITY MODEL. The SVG is decorative (`aria-hidden`): it conveys shape,
 * not data. The DATA is reachable three ways that do not require a pointer —
 * a roving-focus cursor with arrow keys, a live region that announces the
 * focused bucket's exact values, and a full table alternative that can be opened
 * at any time. Series are distinguished by pattern AND colour AND legend text,
 * never by colour alone.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { formatCount, formatRatio, INSUFFICIENT_DATA } from "./analytics-labels";

export interface ChartSeries {
  key: string;
  label: string;
  /** A design-token colour. Never the only distinction — see `pattern`. */
  color: string;
  /** Redundant encoding for colour-blind readers and monochrome printing. */
  pattern: "solid" | "hatch" | "dots";
}

export interface ChartBucket {
  label: string;
  /** Exact values, keyed by series. A count, or an exact decimal ratio string. */
  values: Record<string, number | string | null>;
}

export interface SeriesChartProps {
  buckets: readonly ChartBucket[];
  series: readonly ChartSeries[];
  /** Counts and rates are never drawn on one axis. */
  kind: "count" | "rate";
  title: string;
  /** Rendered as the axis caption, e.g. "Событий" or "Доля". */
  valueAxisLabel: string;
  emptyMessage: string;
  className?: string;
}

const CHART_HEIGHT = 200;
const BAR_SLOT = 14;
const GROUP_GAP = 12;
const MIN_VISIBLE = 2;

/**
 * Bar geometry widens when a series is short.
 *
 * Bar WIDTH encodes nothing — only height carries data — so widening the slot
 * for a short series changes no meaning. It does change readability: three
 * monthly buckets at the dense 14px slot filled about a fifth of the container
 * and left the rest empty, with axis labels too small to read comfortably.
 * A long series keeps the dense slot and scrolls, which is what makes 400
 * buckets viewable at all.
 */
function slotFor(bucketCount: number): { slot: number; gap: number } {
  if (bucketCount <= 6) return { slot: 40, gap: 32 };
  if (bucketCount <= 14) return { slot: 26, gap: 20 };
  return { slot: BAR_SLOT, gap: GROUP_GAP };
}

/** A rate string as a 0..1 number, for geometry only. Never for display. */
function rateMagnitude(value: number | string | null): number | null {
  if (value === null) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function displayValue(value: number | string | null, kind: "count" | "rate"): string {
  if (kind === "rate") return formatRatio(value === null ? null : String(value));
  if (value === null) return INSUFFICIENT_DATA;
  return formatCount(typeof value === "number" ? value : Number(value));
}

/**
 * The top of the value axis.
 *
 * For counts it is the largest value present, so the tallest column fills the
 * plot. For rates it is a FIXED 100 %: a rate axis that rescaled to its own
 * maximum would make a 2 % conversion rate and a 90 % one look identical
 * whenever they were viewed separately.
 */
function axisMaximum(
  buckets: readonly ChartBucket[],
  series: readonly ChartSeries[],
  kind: "count" | "rate",
): number {
  if (kind === "rate") return 1;
  let max = 0;
  for (const bucket of buckets) {
    for (const item of series) {
      const value = rateMagnitude(bucket.values[item.key] ?? null);
      if (value !== null && value > max) max = value;
    }
  }
  return max === 0 ? 1 : max;
}

export function SeriesChart({
  buckets,
  series,
  kind,
  title,
  valueAxisLabel,
  emptyMessage,
  className,
}: SeriesChartProps) {
  const [cursor, setCursor] = React.useState(0);
  const [tableOpen, setTableOpen] = React.useState(false);
  const tableId = React.useId();

  // The cursor must never point past the end after a filter change replaced the
  // series with a shorter one.
  React.useEffect(() => {
    setCursor((current) => (current >= buckets.length ? 0 : current));
  }, [buckets.length]);

  if (buckets.length === 0 || series.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md border border-border bg-surface p-6 text-center text-sm text-text-secondary",
          className,
        )}
      >
        {emptyMessage}
      </div>
    );
  }

  const maximum = axisMaximum(buckets, series, kind);
  const { slot, gap } = slotFor(buckets.length);
  const groupWidth = series.length * slot + gap;
  const plotWidth = buckets.length * groupWidth;

  const focused = buckets[Math.min(cursor, buckets.length - 1)]!;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") {
      setCursor((c) => Math.min(c + 1, buckets.length - 1));
    } else if (event.key === "ArrowLeft") {
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === "Home") {
      setCursor(0);
    } else if (event.key === "End") {
      setCursor(buckets.length - 1);
    } else {
      return;
    }
    // Only after a handled key: an unhandled key must keep its default so the
    // chart never traps the keyboard.
    event.preventDefault();
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Legend. Text label + colour + pattern swatch: three encodings, so the
          series are distinguishable without colour vision and in print. */}
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Обозначения графика">
        {series.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5 text-xs text-text-secondary">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 shrink-0 rounded-sm border border-border"
              style={{
                backgroundColor: item.color,
                backgroundImage:
                  item.pattern === "hatch"
                    ? "repeating-linear-gradient(45deg, rgba(255,255,255,.85) 0 2px, transparent 2px 4px)"
                    : item.pattern === "dots"
                      ? "radial-gradient(rgba(255,255,255,.9) 1px, transparent 1px)"
                      : undefined,
                backgroundSize: item.pattern === "dots" ? "4px 4px" : undefined,
              }}
            />
            <span>{item.label}</span>
          </li>
        ))}
      </ul>

      {/* The plot. Its own horizontal scroller, so a long series never widens
          the page — §37 forbids whole-page horizontal overflow. */}
      <div
        role="group"
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label={`${title}. Столбцов: ${buckets.length}. Стрелками влево и вправо — переход между точками.`}
        className="overflow-x-auto rounded-md border border-border bg-surface p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <svg
          aria-hidden="true"
          focusable="false"
          width={Math.max(plotWidth, 240)}
          height={CHART_HEIGHT + 28}
          role="presentation"
        >
          {/* Baseline. Drawn so a row of zero buckets is visibly a floor rather
              than an absence of data. */}
          <line
            x1={0}
            y1={CHART_HEIGHT}
            x2={Math.max(plotWidth, 240)}
            y2={CHART_HEIGHT}
            className="stroke-border"
            strokeWidth={1}
          />
          {buckets.map((bucket, index) => {
            const groupX = index * groupWidth;
            const isFocused = index === Math.min(cursor, buckets.length - 1);
            return (
              <g key={`${bucket.label}-${index}`}>
                {isFocused ? (
                  <rect
                    x={groupX - 2}
                    y={0}
                    width={groupWidth}
                    height={CHART_HEIGHT}
                    className="fill-accent/10"
                  />
                ) : null}
                {series.map((item, seriesIndex) => {
                  const raw = bucket.values[item.key] ?? null;
                  const magnitude = rateMagnitude(raw);
                  // A null rate has NO bar. Drawing a zero-height bar for
                  // "недостаточно данных" would put an absence on the axis as
                  // if it were a measured zero.
                  if (magnitude === null) return null;
                  const scaled = Math.max(
                    (magnitude / maximum) * CHART_HEIGHT,
                    magnitude > 0 ? MIN_VISIBLE : 0,
                  );
                  const height = Math.min(scaled, CHART_HEIGHT);
                  return (
                    <rect
                      key={item.key}
                      x={groupX + seriesIndex * slot + 2}
                      y={CHART_HEIGHT - height}
                      width={slot - 4}
                      height={height}
                      fill={item.color}
                      // A zero value keeps a 1px tick on the baseline: a bucket
                      // that reported zero is visibly present, not missing.
                      stroke={magnitude === 0 ? item.color : undefined}
                      strokeWidth={magnitude === 0 ? 1.5 : undefined}
                    />
                  );
                })}
                <text
                  x={groupX + (groupWidth - gap) / 2}
                  y={CHART_HEIGHT + 16}
                  textAnchor="middle"
                  className="fill-text-secondary text-[10px]"
                >
                  {/* The BACKEND's label, never a re-derived date. */}
                  {bucket.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* The focused bucket's exact values, always visible — this is the
          "values without hover" requirement, and it doubles as the live region
          that announces cursor movement. */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="rounded-md border border-border bg-elevated px-3 py-2 text-sm"
      >
        <span className="font-medium text-text-primary">{focused.label}</span>
        <span className="sr-only">. </span>
        <span className="ml-2 inline-flex flex-wrap gap-x-4 gap-y-1 text-text-secondary">
          {series.map((item) => (
            <span key={item.key}>
              {item.label}: {displayValue(focused.values[item.key] ?? null, kind)}
            </span>
          ))}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-text-secondary">
          Ось значений: {valueAxisLabel}
          {kind === "rate" ? " (шкала 0–100 %)" : ""}
        </p>
        <button
          type="button"
          onClick={() => setTableOpen((open) => !open)}
          aria-expanded={tableOpen}
          aria-controls={tableId}
          className="rounded-md border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {tableOpen ? "Скрыть таблицу" : "Показать таблицу"}
        </button>
      </div>

      {/* The text alternative. A real table with headers, containing exactly the
          values the chart drew — including the zero buckets and the nulls the
          chart could not draw a bar for. */}
      <div id={tableId} hidden={!tableOpen}>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <caption className="sr-only">{title} — табличное представление</caption>
            <thead>
              <tr className="border-b border-border bg-elevated">
                <th scope="col" className="px-3 py-2 text-left font-medium text-text-secondary">
                  Период
                </th>
                {series.map((item) => (
                  <th
                    key={item.key}
                    scope="col"
                    className="px-3 py-2 text-right font-medium text-text-secondary"
                  >
                    {item.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket, index) => (
                <tr key={`${bucket.label}-${index}`} className="border-b border-border last:border-0">
                  <th scope="row" className="px-3 py-1.5 text-left font-normal text-text-primary">
                    {bucket.label}
                  </th>
                  {series.map((item) => (
                    <td key={item.key} className="px-3 py-1.5 text-right tabular-nums">
                      {displayValue(bucket.values[item.key] ?? null, kind)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
