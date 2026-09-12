"use client";

/**
 * G4-GROWTH — the display pieces the Growth workspace is built from.
 *
 * THE RULE THEY ALL SHARE: AN ABSENCE IS RENDERED AS AN ABSENCE. `GrowthMetric`
 * takes a number and shows it, including a real 0. `GrowthRatio` takes an exact
 * decimal string OR null and shows "Недостаточно данных" for the null — it has
 * no code path that produces "0 %" from one. `UnavailableCapability` renders a
 * missing capability as a NAMED REASON and never as a tile, because a tile is
 * where a reader expects to find a number.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import type { GrowthAvailabilityState } from "@/data/contracts/api/growth";
import {
  CAPABILITY_LABEL,
  INSUFFICIENT_DATA,
  availabilityReason,
  formatCount,
  formatRatio,
  isRatioUnavailable,
} from "./growth-labels";

export function GrowthSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
        {description ? (
          <p className="mt-0.5 max-w-3xl break-words text-xs leading-relaxed text-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * A short explanatory note, as ordinary visible text.
 *
 * Deliberately not a tooltip. A caveat that has to be hovered to be discovered
 * is a caveat most readers never see, and the ones this workspace carries —
 * what an unresolved redeposit means, which attribution model is in force — are
 * the difference between reading a number correctly and misreading it.
 */
export function GrowthNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-border bg-elevated px-3 py-2 text-xs leading-relaxed text-text-secondary">
      {children}
    </p>
  );
}

export function GrowthMetric({
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
      {hint ? (
        <p className="mt-1 break-words text-[11px] leading-snug text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * A ratio with its denominator named.
 *
 * THE DENOMINATOR IS ALWAYS SHOWN. "Клик → регистрация 4,2 %" is ambiguous until
 * the reader knows what it is a fraction of. The unavailable state is styled
 * DIFFERENTLY from a real value, not merely worded differently, so it cannot be
 * skimmed as a number.
 */
export function GrowthRatio({
  label,
  value,
  denominatorLabel,
}: {
  label: string;
  value: string | null;
  denominatorLabel?: string;
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
      {unavailable ? (
        <span className="sr-only">
          {INSUFFICIENT_DATA}: знаменатель равен нулю. Это не ноль процентов.
        </span>
      ) : null}
    </div>
  );
}

/**
 * A capability the platform cannot currently measure.
 *
 * DELIBERATELY NOT A TILE. A tile with a dash in it still occupies the place a
 * reader looks for a number, and after a few visits a dash reads as a small
 * number. This renders as a labelled sentence instead.
 */
export function UnavailableCapability({
  capability,
  state,
}: {
  capability: string;
  state: GrowthAvailabilityState;
}) {
  if (state.available) return null;
  return (
    <li className="flex flex-col gap-0.5 rounded-md border border-dashed border-border px-3 py-2">
      <span className="text-xs font-medium text-text-primary">
        {CAPABILITY_LABEL[capability] ?? capability}
      </span>
      <span className="text-[11px] leading-snug text-text-muted">
        {availabilityReason(state.reason)}
      </span>
    </li>
  );
}

export function AvailabilityList({
  availability,
}: {
  availability: Record<string, GrowthAvailabilityState>;
}) {
  const unavailable = Object.entries(availability).filter(([, state]) => !state.available);
  if (unavailable.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-text-primary">Что платформа не измеряет</h3>
      <ul className="space-y-1.5">
        {unavailable.map(([capability, state]) => (
          <UnavailableCapability key={capability} capability={capability} state={state} />
        ))}
      </ul>
    </div>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-md border border-border bg-elevated px-3 py-6 text-center text-xs text-text-secondary"
    >
      {label}
    </div>
  );
}

export function ErrorBlock({ message, requestId }: { message: string; requestId?: string }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-danger/40 bg-danger/5 px-3 py-3 text-xs text-text-primary"
    >
      <p>{message}</p>
      {requestId ? (
        <p className="mt-1 text-[11px] text-text-muted">Идентификатор запроса: {requestId}</p>
      ) : null}
    </div>
  );
}
