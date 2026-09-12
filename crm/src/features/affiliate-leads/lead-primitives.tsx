"use client";

/**
 * AFD-5C2 — the small display pieces the lead workspace is built from.
 *
 * THE RULE THEY ALL SHARE: A STATE IS NEVER CARRIED BY COLOUR ALONE. Every chip
 * below renders its own word — "Ожидает подтверждения Pocket-пользователя",
 * "Требует проверки конфликта" — and the tint is redundant reinforcement. An
 * operator with a monochrome display, a colour-vision difference or a screen
 * reader gets the same information as everybody else.
 *
 * AN ABSENCE IS RENDERED AS AN ABSENCE. `AvailabilityList` renders an
 * unavailable capability as a NAMED REASON and never as a tile, because a tile
 * is a place a reader expects to find a number — and "0 повторных депозитов"
 * would be a business claim this platform cannot support.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import type {
  LeadAttributionState,
  LeadDepositState,
  LeadIntegrityFlag,
  LeadJourneyStage,
} from "@/data/contracts/api/affiliate-leads";
import {
  ATTRIBUTION_STATE_HINT,
  ATTRIBUTION_STATE_LABEL,
  AVAILABILITY_CAPABILITY_LABEL,
  AVAILABLE_LABEL,
  availabilityReasonLabel,
  DEPOSIT_STATE_HINT,
  DEPOSIT_STATE_LABEL,
  INTEGRITY_FLAG_LABEL,
  INTEGRITY_NOTE,
  INTEGRITY_TITLE,
  JOURNEY_STAGE_HINT,
  JOURNEY_STAGE_LABEL,
  REFRESHING_LABEL,
} from "./leads-labels";

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
        <Tag
          id={id}
          className={cn(
            "font-semibold text-text-primary",
            level === 2 ? "text-base" : "text-sm",
          )}
        >
          {title}
        </Tag>
        {description ? (
          <p className="mt-0.5 max-w-3xl break-words text-xs leading-relaxed text-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * A short explanatory note, rendered as ordinary visible text.
 *
 * Never a tooltip: a caveat that has to be hovered to be found is a caveat most
 * readers never see, and every caveat on this screen exists to stop a number
 * being misread.
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

/* --------------------------------------------------------------- the chips */

/**
 * `rounded-md`, not `rounded-full`.
 *
 * MEASURED, NOT PREFERRED. The Russian state labels are long — "Ожидает
 * подтверждения Pocket-пользователя" is thirty-eight characters — and inside a
 * pill they wrapped to three lines, producing a lozenge with huge round ends
 * that dragged the table row to ~90px while its neighbours stayed at ~60px. The
 * result was a list whose row height encoded nothing but label length. A modest
 * corner radius wraps as an ordinary block of text and keeps the rows even.
 */
const CHIP_BASE =
  "inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-snug break-words";

/**
 * The journey stage.
 *
 * READ FROM THE LEDGER, NEVER INFERRED. This component takes the backend's own
 * enum member and looks up a label; there is no branch that upgrades a stage
 * from a deposit state, a balance or a timestamp comparison.
 */
export function JourneyChip({
  stage,
  withHint = false,
}: {
  stage: LeadJourneyStage;
  withHint?: boolean;
}) {
  const tone =
    stage === "first_deposit_confirmed"
      ? "border-success/40 bg-success/10 text-text-primary"
      : stage === "pocket_registered"
        ? "border-info/40 bg-info/10 text-text-primary"
        : "border-border bg-elevated text-text-secondary";

  return (
    <span className={cn(CHIP_BASE, tone)} title={withHint ? JOURNEY_STAGE_HINT[stage] : undefined}>
      {JOURNEY_STAGE_LABEL[stage]}
    </span>
  );
}

/**
 * The first-deposit state.
 *
 * PENDING AND CONFLICT ARE VISUALLY DISTINCT FROM CONFIRMED, and each carries
 * its own sentence. `none` is muted rather than red: no deposit event is a
 * neutral fact about most leads, not a failure.
 */
export function DepositChip({
  state,
  withHint = false,
}: {
  state: LeadDepositState;
  withHint?: boolean;
}) {
  const tone =
    state === "confirmed"
      ? "border-success/40 bg-success/10 text-text-primary"
      : state === "conflict"
        ? "border-danger/40 bg-danger/10 text-text-primary"
        : state === "pending_identity"
          ? "border-warning/40 bg-warning/10 text-text-primary"
          : "border-border bg-elevated text-text-muted";

  return (
    <span className={cn(CHIP_BASE, tone)} title={withHint ? DEPOSIT_STATE_HINT[state] : undefined}>
      {DEPOSIT_STATE_LABEL[state]}
    </span>
  );
}

/** Attributed or direct. A direct lead is never given a synthetic affiliate. */
export function AttributionChip({
  state,
  withHint = false,
}: {
  state: LeadAttributionState;
  withHint?: boolean;
}) {
  return (
    <span
      className={cn(
        CHIP_BASE,
        state === "attributed"
          ? "border-accent/40 bg-accent/5 text-text-primary"
          : "border-border bg-surface text-text-secondary",
      )}
      title={withHint ? ATTRIBUTION_STATE_HINT[state] : undefined}
    >
      {ATTRIBUTION_STATE_LABEL[state]}
    </span>
  );
}

/* ------------------------------------------------------------- integrity */

/**
 * The integrity findings, as a real list with a real heading.
 *
 * SEPARATE FROM THE TIMELINE, always. A finding describes the shape of the
 * stored data; putting it among the events would make it look like something
 * that happened to the learner at a particular moment.
 */
export function IntegrityFlags({
  flags,
  className,
}: {
  flags: readonly LeadIntegrityFlag[];
  className?: string;
}) {
  if (flags.length === 0) return null;
  return (
    <section
      aria-labelledby="lead-integrity-heading"
      // `aria-live` sits on the SECTION, not on the heading.
      //
      // A `role="status"` on the `<h3>` would REPLACE its implicit heading role,
      // so the findings would be announced once and then be unreachable through
      // heading navigation — the one way a screen-reader user scans a long lead
      // card. Announcing the region instead keeps both: the findings are read
      // out when they appear AND the heading stays a heading.
      //
      // `polite`, not `alert`: these are findings to read, not an interruption.
      aria-live="polite"
      className={cn(
        "rounded-md border border-warning/40 bg-warning/10 p-3",
        className,
      )}
    >
      <h3 id="lead-integrity-heading" className="text-sm font-semibold text-text-primary">
        {INTEGRITY_TITLE}
      </h3>
      <ul className="mt-2 space-y-1">
        {flags.map((flag) => (
          <li key={flag} className="break-words text-xs leading-relaxed text-text-primary">
            {INTEGRITY_FLAG_LABEL[flag]}
          </li>
        ))}
      </ul>
      <p className="mt-2 break-words text-[11px] leading-snug text-text-secondary">
        {INTEGRITY_NOTE}
      </p>
    </section>
  );
}

/* --------------------------------------------------------- definition list */

/**
 * One labelled fact.
 *
 * STACKED, not a two-column row. The values here are timestamps and whole
 * sentences, and side by side the LABEL was the thing that got squeezed to zero
 * width — the explanation survived and the name of the field vanished, which is
 * exactly backwards.
 */
export function FactRow({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="min-w-0 border-b border-border/60 pb-1.5">
      <dt className="break-words text-xs font-medium text-text-secondary">{label}</dt>
      <dd className="mt-0.5 break-words text-sm leading-snug text-text-primary">{children}</dd>
      {hint ? (
        <p className="mt-0.5 break-words text-[11px] leading-snug text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function FactList({ children }: { children: React.ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">{children}</dl>;
}

/* ------------------------------------------------------------ availability */

/**
 * The "Доступность данных" section.
 *
 * A definition list rather than a grid of cards, deliberately: an unavailable
 * capability has no value, and a card shaped like a metric tile is how
 * "0 повторных депозитов" gets read as a business fact. Available capabilities
 * are listed too, because the section answers "что вообще можно узнать про этого
 * лида" and a list of only the gaps does not.
 */
export function AvailabilityList({
  entries,
}: {
  entries: readonly { key: string; available: boolean; reason?: string }[];
}) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {entries.map((entry) => (
        <div key={entry.key} className="min-w-0 border-b border-border/60 pb-1.5">
          <dt className="break-words text-xs font-medium text-text-secondary">
            {AVAILABILITY_CAPABILITY_LABEL[entry.key] ?? entry.key}
          </dt>
          <dd
            className={cn(
              "mt-0.5 break-words text-[11px] leading-snug",
              entry.available ? "text-success" : "text-text-muted",
            )}
          >
            {/* Status is never colour-only: the word itself carries it. */}
            {entry.available
              ? AVAILABLE_LABEL
              : availabilityReasonLabel(entry.reason ?? "")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ----------------------------------------------------------------- states */

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
  retryLabel = "Повторить",
}: {
  message: string;
  requestId?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div
      role="alert"
      className="rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-text-primary"
    >
      <p className="break-words">{message}</p>
      {requestId ? (
        <p className="mt-1 break-all text-[11px] text-text-muted">
          Идентификатор запроса: {requestId}
        </p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 min-h-[2.25rem] rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {retryLabel}
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
      {REFRESHING_LABEL}
    </span>
  );
}
