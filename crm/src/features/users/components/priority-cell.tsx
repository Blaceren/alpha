import * as React from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip } from "@/components/ui/tooltip";
import type { BadgeProps } from "@/components/ui/badge";
import { PRIORITY_LABEL, PRIORITY_REASON_LABEL } from "@/config/labels";
import type { PriorityBand } from "@/domain/priority/priority";

const PRIORITY_TONE: Record<PriorityBand, NonNullable<BadgeProps["tone"]>> = {
  critical: "danger",
  high: "warning",
  normal: "info",
  low: "neutral",
};

export function PriorityCell({
  priority,
  reasonCode,
  fullReason = false,
}: {
  priority: PriorityBand;
  reasonCode?: string;
  /** When true (mobile card) the reason wraps and is fully readable without hover. */
  fullReason?: boolean;
}) {
  const reason = reasonCode ? PRIORITY_REASON_LABEL[reasonCode] ?? reasonCode : null;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <Tooltip content={reason ?? PRIORITY_LABEL[priority]} side="top">
        <span className="inline-flex">
          {/* label always present → not color-only */}
          <StatusBadge tone={PRIORITY_TONE[priority]} label={PRIORITY_LABEL[priority]} />
        </span>
      </Tooltip>
      {reason ? (
        <span
          className={
            fullReason
              ? "text-2xs text-text-muted"
              : // Table: one truncated line on desktop; hidden at tablet (md..xl)
                // to keep the compact table within the viewport — tooltip has it.
                "hidden max-w-[8rem] truncate text-2xs text-text-muted xl:block"
          }
        >
          {reason}
        </span>
      ) : null}
    </div>
  );
}
