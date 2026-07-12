import * as React from "react";
import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Persistent DEMO MODE marker. Always visible alongside the role switch so no
 * one mistakes the mock frontend for production (DECISIONS D-12).
 */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-warning",
        className,
      )}
      title="Демо-режим: синтетические данные, без production. Не является production-безопасностью."
    >
      <FlaskConical className="h-3 w-3" aria-hidden />
      DEMO MODE
    </span>
  );
}
