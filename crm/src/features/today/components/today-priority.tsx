import * as React from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { BadgeProps } from "@/components/ui/badge";
import { PRIORITY_LABEL } from "@/config/labels";
import type { PriorityBand } from "@/domain/priority/priority";

const PRIORITY_TONE: Record<PriorityBand, NonNullable<BadgeProps["tone"]>> = {
  critical: "danger",
  high: "warning",
  normal: "info",
  low: "neutral",
};

/**
 * How urgent this row is. The band, and only the band.
 *
 * The rule that produced it (`priorityReasonCode`) is deliberately NOT rendered
 * here: the priority ladder reads the same signals the bases do, so the label is
 * always a blunter restatement of the reason the row already prints one column
 * over — "Критический support-блокер" above "Открыт support-блокер." (§10).
 * The band answers "how soon", the reason answers "why", and User 360 keeps the
 * ladder itself on the record.
 *
 * Always carries its text label, so urgency is never colour-only (§25).
 */
export function TodayPriority({ priority }: { priority: PriorityBand }) {
  return <StatusBadge tone={PRIORITY_TONE[priority]} label={PRIORITY_LABEL[priority]} />;
}
