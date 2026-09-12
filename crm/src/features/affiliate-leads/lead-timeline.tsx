"use client";

/**
 * AFD-5C2 — the factual lead timeline.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: EVERY ITEM COMES FROM THE RESPONSE, IN
 * THE RESPONSE'S ORDER. There is no `.sort()` in this file, no `.filter()` that
 * drops an event, no interpolation of a missing milestone, no step synthesised
 * from the current stage, and no item dated from the browser clock. A journey
 * with gaps renders with gaps.
 *
 * WHY THAT MATTERS MORE HERE THAN ANYWHERE ELSE. A timeline is read as a
 * narrative, and a narrative is exactly the format in which an invented step is
 * least likely to be questioned. "Депозит получен, затем подтверждён" looks like
 * a fact even when only one instant was ever recorded — so the pending step is
 * drawn only when the backend emitted one, which it does only when two stored
 * timestamps actually disagree.
 *
 * A SEMANTIC ORDERED LIST, NOT A DECORATED DIV. `<ol>` is what tells a screen
 * reader that these are steps in sequence and how many there are. The connector
 * line and the dots are `aria-hidden` ornaments over that structure — remove the
 * CSS and the meaning survives intact.
 *
 * NO CHART LIBRARY. A factual list of at most six events does not justify a
 * dependency, and a chart would invite an animated progression that implies
 * causality the data does not support.
 *
 * NO RAW IDENTIFIER REACHES THE DOM. An item carries a tracking-link display
 * name and public code and nothing else — the contract's `.strict()` refuses a
 * click id, and there is no `data-` attribute or `title` here that could carry
 * one.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import type { LeadTimeline, LeadTimelineItem } from "@/data/contracts/api/affiliate-leads";
import {
  INTEGRITY_FLAG_LABEL,
  TIMELINE_EMPTY,
  TIMELINE_EVENT_LABEL,
  TIMELINE_NOTE,
  TIMELINE_SOURCE_LABEL,
  TIMELINE_STATE_LABEL,
  TIMELINE_TITLE,
  timelineTruncatedLabel,
  TOUCH_ROLE_LABEL,
  formatInstant,
  instantAccessibleLabel,
} from "./leads-labels";

/**
 * The marker for one item.
 *
 * Shape as well as tint: `pending` is a hollow ring, `conflict` a thicker ring,
 * `confirmed` a filled dot. State is never carried by colour alone, and the
 * text label beside it says the same thing in words regardless.
 */
function StateDot({ state }: { state: LeadTimelineItem["state"] }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-1.5 block h-2.5 w-2.5 shrink-0 rounded-full border-2",
        state === "confirmed"
          ? "border-success bg-success"
          : state === "conflict"
            ? "border-danger bg-surface"
            : state === "pending"
              ? "border-warning bg-surface"
              : "border-text-muted bg-text-muted",
      )}
    />
  );
}

function TimelineEntry({ item }: { item: LeadTimelineItem }) {
  const roles = item.roles ?? [];

  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {/* The connector. Purely decorative, and hidden from assistive tech: the
          `<ol>` already conveys sequence. */}
      <span
        aria-hidden
        className="absolute left-[0.3125rem] top-4 h-[calc(100%-0.5rem)] w-px bg-border last:hidden"
      />
      <StateDot state={item.state} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="break-words text-sm font-medium text-text-primary">
            {TIMELINE_EVENT_LABEL[item.eventType]}
          </p>
          {/* The state as a WORD. `recorded` is left implicit — every item is
              recorded, and repeating it on six rows is noise that would bury the
              two states that matter. */}
          {item.state !== "recorded" ? (
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]",
                item.state === "confirmed"
                  ? "border-success/40 bg-success/10 text-text-primary"
                  : item.state === "conflict"
                    ? "border-danger/40 bg-danger/10 text-text-primary"
                    : "border-warning/40 bg-warning/10 text-text-primary",
              )}
            >
              {TIMELINE_STATE_LABEL[item.state]}
            </span>
          ) : null}
        </div>

        {/*
          THE SAME INSTANT, THE SAME ZONE, IN THE SAME FORM AS EVERY OTHER
          TIMESTAMP ON THIS SCREEN.

          The backend sends `localOccurredAt` as `2026-03-01T08:00:00` — an exact
          Europe/Moscow wall clock, but in a machine shape that sat beside the
          list's `01.03.2026, 08:00` and read as a different KIND of value.
          `formatInstant` re-renders the very same instant with an explicit
          `timeZone: "Europe/Moscow"`, so nothing is recomputed into the
          browser's zone and nothing changes but the punctuation. The backend's
          own string is kept verbatim for anyone who wants the exact form.
        */}
        <p className="mt-0.5 break-words text-xs tabular-nums text-text-secondary">
          <time dateTime={item.occurredAt}>{formatInstant(item.occurredAt)}</time>
          <span className="sr-only">
            {" "}
            ({instantAccessibleLabel(item.occurredAt)}; точно: {item.localOccurredAt})
          </span>
        </p>

        <p className="mt-0.5 break-words text-[11px] leading-snug text-text-muted">
          {TIMELINE_SOURCE_LABEL[item.sourceCategory]}
          {/* ONE item may carry SEVERAL touch roles — the backend collapses
              first/last/selected that share a click row into a single event, and
              flattening that back into three rows would claim three visits where
              there was one. */}
          {roles.length > 0
            ? ` · ${roles.map((role) => TOUCH_ROLE_LABEL[role]).join(", ")}`
            : ""}
          {item.dimension
            ? ` · ${item.dimension.displayName} (${item.dimension.trackingLinkPublicCode})`
            : ""}
        </p>

        {item.integrityFlags.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {item.integrityFlags.map((flag) => (
              <li key={flag} className="break-words text-[11px] leading-snug text-warning">
                {INTEGRITY_FLAG_LABEL[flag]}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

export function LeadTimelineView({ timeline }: { timeline: LeadTimeline }) {
  return (
    <section aria-labelledby="lead-timeline-heading" className="space-y-2">
      <h2 id="lead-timeline-heading" className="text-base font-semibold text-text-primary">
        {TIMELINE_TITLE}
      </h2>
      <p className="max-w-3xl break-words text-xs leading-relaxed text-text-secondary">
        {TIMELINE_NOTE}
      </p>

      {timeline.items.length === 0 ? (
        <p className="rounded-md border border-border bg-surface p-4 text-sm text-text-secondary">
          {TIMELINE_EMPTY}
        </p>
      ) : (
        // Named after its own heading, so a screen reader announces "список
        // Фактическая хронология" rather than an anonymous list of eight items.
        <ol aria-labelledby="lead-timeline-heading" className="mt-2">
          {timeline.items.map((item, index) => (
            // The index is part of the key ONLY as a tie-breaker: two items can
            // legitimately share an event type and an instant, and the response
            // order is the identity. Nothing is reordered, so the index is
            // stable for a given response.
            <TimelineEntry key={`${item.eventType}-${item.occurredAt}-${index}`} item={item} />
          ))}
        </ol>
      )}

      {/* Overflow is reported when the backend says so, never guessed. */}
      {timeline.truncated ? (
        <p role="status" className="break-words text-xs text-warning">
          {timelineTruncatedLabel(timeline.maxItems)}
        </p>
      ) : null}
    </section>
  );
}
