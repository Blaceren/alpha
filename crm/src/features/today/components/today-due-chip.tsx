import * as React from "react";
import { CalendarClock } from "lucide-react";
import type { TodayDue } from "@/domain/today/today";
import type { BadgeProps } from "@/components/ui/badge";
import { Badge } from "@/components/ui/badge";
import { TODAY_LABEL } from "@/config/labels";

/**
 * A deadline, in words: what kind of clock, and how long until (or since) it.
 *
 * The chip spells the state out — "просрочен 6 ч", "под риском" — so the SLA is
 * readable in greyscale and by a screen reader; tone only reinforces it (§25).
 *
 * It deliberately does NOT print the SLA key ("Проверка ментора"): the row's
 * reason and recommendation already say what the work is, the label was long
 * enough to clip its own column, and repeating it made rows state one fact
 * three times. Which contract the clock belongs to is a User 360 detail.
 *
 * `hoursUntil` is computed by the provider against its clock — nothing here
 * calls `Date.now()`, which is what keeps the row deterministic (§20).
 */
export function TodayDueChip({ due }: { due: TodayDue | null }) {
  if (!due) return <span className="text-2xs text-text-muted">без срока</span>;

  const overdue = due.hoursUntil < 0;
  const span = formatSpan(Math.abs(due.hoursUntil));

  // Two lines, not one: "SLA · под риском · через 4 ч" on a single nowrap chip
  // overflowed its column and clipped its own timing. The badge carries WHAT
  // and the state; the line under it carries WHEN.
  const kind = due.isSla ? "SLA" : TODAY_LABEL.due;
  const state = overdue ? "просрочен" : due.state === "warning" ? "под риском" : null;
  const when = overdue ? `${span} назад` : `через ${span}`;

  const tone: NonNullable<BadgeProps["tone"]> = overdue
    ? "danger"
    : due.state === "warning"
      ? "warning"
      : "neutral";

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Badge tone={tone} className="whitespace-nowrap">
        <CalendarClock aria-hidden className="h-3 w-3" />
        {state ? `${kind} · ${state}` : kind}
      </Badge>
      <span className="whitespace-nowrap pl-0.5 text-2xs text-text-muted">{when}</span>
    </span>
  );
}

/** Hours are the domain's unit; days become readable past a couple of them. */
function formatSpan(hours: number): string {
  if (hours < 1) return "менее часа";
  if (hours < 48) return `${hours} ч`;
  return `${Math.round(hours / 24)} д`;
}
