import * as React from "react";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface StaleDataIndicatorProps {
  /** ISO timestamp the data was last known fresh. */
  asOf: string;
  label?: string;
}

/** Small badge signalling stale data (financial/aggregate values must show freshness). */
export function StaleDataIndicator({ asOf, label }: StaleDataIndicatorProps) {
  const when = safeFormat(asOf);
  return (
    <Badge tone="warning" title={`Обновлено: ${when}`}>
      <Clock className="h-3 w-3" aria-hidden />
      {label ?? `устарело · ${when}`}
    </Badge>
  );
}

function safeFormat(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
