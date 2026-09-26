import * as React from "react";
import type { TodaySummary } from "@/domain/today/today";
import { TODAY_LABEL } from "@/config/labels";
import { cn } from "@/lib/cn";

/**
 * A compact operational strip — deliberately NOT a dashboard.
 *
 * Four counts, inline, one line: enough to know the shape of the day before you
 * start reading rows. No cards, no charts, no deltas, no targets — those answer
 * "how are we doing this quarter", which is a different product. Every number
 * describes the queue currently on screen, so it moves with the filters and can
 * never count a user this role cannot see (§9).
 */
export function TodaySummaryStrip({ summary }: { summary: TodaySummary }) {
  const stats: { label: string; value: number; urgent?: boolean }[] = [
    { label: TODAY_LABEL.totalAttention, value: summary.totalAttention },
    { label: TODAY_LABEL.critical, value: summary.critical, urgent: summary.critical > 0 },
    { label: TODAY_LABEL.slaBreached, value: summary.slaBreached, urgent: summary.slaBreached > 0 },
    { label: TODAY_LABEL.unassigned, value: summary.unassigned },
  ];

  return (
    <dl className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {stats.map((s) => (
        <div key={s.label} className="flex items-baseline gap-1.5">
          <dd
            className={cn(
              "text-sm font-semibold tabular-nums",
              s.urgent ? "text-danger" : "text-text-primary",
            )}
          >
            {s.value}
          </dd>
          <dt className="text-2xs text-text-secondary">{s.label}</dt>
        </div>
      ))}
    </dl>
  );
}
