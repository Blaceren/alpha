import * as React from "react";
import { Clock } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import type { FinancialProjection } from "@/domain/financial/projection";

/**
 * Renders ONLY the provider's permission-aware projection. The provider never
 * sends an exact amount for roles without financial permission, so an exact
 * value can never appear in the DOM for those roles. No exact value is placed
 * into title/data-* and nothing is hidden by CSS alone.
 */
export function FinancialCell({ projection }: { projection?: FinancialProjection }) {
  if (!projection || projection.mode === "hidden") {
    return (
      <Tooltip content="Финансовые данные недоступны для вашей роли" side="top">
        <span className="text-2xs text-text-muted">Недоступно для роли</span>
      </Tooltip>
    );
  }

  const suffix =
    projection.mode === "bucket" ? "диапазон" : projection.mode === "aggregated" ? "агрег." : null;

  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-xs tabular-nums text-text-primary">{projection.label}</span>
      {suffix ? <span className="text-2xs text-text-muted">{suffix}</span> : null}
      {projection.stale ? (
        <Tooltip content="Данные устарели" side="top">
          <span className="inline-flex text-warning" aria-label="устарело">
            <Clock className="h-3 w-3" aria-hidden />
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}
