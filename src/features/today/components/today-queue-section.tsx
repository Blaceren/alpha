import * as React from "react";
import type { TodayQueueSection } from "@/domain/today/today";
import type { TodaySectionKey } from "@/config/queues";
import { cn } from "@/lib/cn";
import { TodayQueueItemRow } from "./today-queue-item";
import { TodayMobileCard } from "./today-mobile-card";

/**
 * Section accent. Colour only ever reinforces the heading text, which already
 * names the urgency ("Просрочено") — the hierarchy survives in greyscale (§25).
 */
const SECTION_ACCENT: Record<TodaySectionKey, string> = {
  overdue: "bg-danger",
  critical_now: "bg-danger/60",
  today: "bg-warning",
  watch: "bg-border",
};

/**
 * One operational group of the queue: a real <section> with its own heading, so
 * the page outline reads as the working day rather than as one flat list.
 * The provider never returns an empty section, so there is no empty case here.
 */
export function TodayQueueSectionBlock({ section }: { section: TodayQueueSection }) {
  const headingId = `today-section-${section.key}`;

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2">
        <span aria-hidden className={cn("h-3 w-1 shrink-0 rounded-full", SECTION_ACCENT[section.key])} />
        <h2 id={headingId} className="text-sm font-semibold text-text-primary">
          {section.title}
        </h2>
        <span className="text-2xs tabular-nums text-text-muted">{section.items.length}</span>
        {/* The hint already reads as a sentence; a leading dash on top of the
            dash inside it ("— Срок или SLA уже нарушен — разбирать первыми")
            just stutters. */}
        <span className="min-w-0 text-2xs text-text-secondary">{section.hint}</span>
      </div>

      {/* Desktop / tablet: dense rows. */}
      <ul className="hidden overflow-hidden rounded-lg border border-border bg-surface md:block">
        {section.items.map((item) => (
          <TodayQueueItemRow key={item.userId} item={item} />
        ))}
      </ul>

      {/* Mobile: the same items, transformed into cards. */}
      <ul className="flex flex-col gap-2 md:hidden">
        {section.items.map((item) => (
          <TodayMobileCard key={item.userId} item={item} />
        ))}
      </ul>
    </section>
  );
}
