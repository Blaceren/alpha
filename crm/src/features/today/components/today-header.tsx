import * as React from "react";
import type { CrmRole } from "@/domain/identity/roles";
import type { TodayFreshness, TodaySummary } from "@/domain/today/today";
import { CRM_ROLE_LABEL } from "@/domain/identity/roles";
import { TODAY_LABEL } from "@/config/labels";
import { Badge } from "@/components/ui/badge";
import { TodaySummaryStrip } from "./today-summary";
import { TodayFreshnessMarker } from "./today-freshness";

/**
 * The header answers "what day is it, whose queue is this, and how big is it"
 * before a single row is read. No hero, no illustration: the h1, the working
 * date, the scope, and four counts.
 */
export function TodayHeader({
  generatedAt,
  role,
  summary,
  freshness,
}: {
  /** Null when the read failed: the working day is the provider's to state, and
   *  substituting the browser's clock would both invent it and break hydration. */
  generatedAt: string | null;
  role: CrmRole;
  summary: TodaySummary | null;
  freshness: TodayFreshness | null;
}) {
  return (
    <header className="border-b border-border pb-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h1 className="text-lg font-semibold text-text-primary">{TODAY_LABEL.title}</h1>
            {/* The working date comes from the provider clock, never from the
                browser — the mock day is 13.07.2026 and must read that way. */}
            {generatedAt ? (
              <span className="text-sm text-text-secondary">{formatWorkingDate(generatedAt)}</span>
            ) : null}
          </div>
          <p className="mt-0.5 max-w-2xl text-sm text-text-secondary">
            Пользователи, у которых есть основание для внимания — по срочности. Спокойные
            пользователи сюда не попадают.
          </p>
        </div>

        {/* No shrink-0: at 390px the freshness timestamp was clipped by the
            edge of the header rather than wrapping onto its own line. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {/* Read-only is stated, not implied by the absence of buttons. */}
          <Badge tone="neutral">{TODAY_LABEL.readOnly}</Badge>
          <Badge tone="neutral" title={TODAY_LABEL.queueScope}>
            {CRM_ROLE_LABEL[role]}
          </Badge>
          {freshness ? <TodayFreshnessMarker freshness={freshness} /> : null}
        </div>
      </div>

      {summary ? (
        <div className="mt-2.5">
          <TodaySummaryStrip summary={summary} />
        </div>
      ) : null}
    </header>
  );
}

/** "понедельник, 13 июля 2026" — the operator's working day, spelled out. */
function formatWorkingDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}
