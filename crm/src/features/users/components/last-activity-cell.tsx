import * as React from "react";
import { Clock } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { formatExactTime, formatRelativeTime } from "@/lib/format";
import { displayNowMs } from "../lib/display-clock";
import type { ISODateString } from "@/domain/shared/primitives";

export function LastActivityCell({
  at,
  stale = false,
}: {
  at: ISODateString | null;
  stale?: boolean;
}) {
  if (!at) return <span className="text-2xs text-text-muted">нет активности</span>;
  const rel = formatRelativeTime(at, displayNowMs());
  return (
    <Tooltip content={formatExactTime(at)} side="top">
      <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
        {rel}
        {stale ? <Clock className="h-3 w-3 text-warning" aria-label="устарело" /> : null}
      </span>
    </Tooltip>
  );
}
