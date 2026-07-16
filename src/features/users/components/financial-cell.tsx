import * as React from "react";
import { Clock } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import {
  FINANCIAL_HIDDEN_LABEL,
  FINANCIAL_HIDDEN_TOOLTIP,
  FINANCIAL_MODE_SUFFIX,
} from "@/config/labels";
import type { FinancialProjection } from "@/domain/financial/projection";

/**
 * Renders ONLY the provider's permission-aware projection. The provider never
 * sends an exact amount for roles without financial permission, so an exact
 * value can never appear in the DOM for those roles. No exact value is placed
 * into title/data-* and nothing is hidden by CSS alone.
 *
 * A hidden value states WHY it is hidden, from the projection's own
 * `hiddenReason` (D-40): "Нет данных" when the product has not sent a value,
 * "Недоступно для роли" when permission withholds one. Telling a permitted role
 * it lacks access to a value that does not exist would simply be false.
 */
export function FinancialCell({ projection }: { projection?: FinancialProjection }) {
  if (!projection || projection.mode === "hidden") {
    // A missing projection is an absent value, not a permission decision.
    const reason = projection?.hiddenReason ?? "no_data";
    return (
      <Tooltip content={FINANCIAL_HIDDEN_TOOLTIP[reason]} side="top">
        <span className="text-2xs text-text-muted">{FINANCIAL_HIDDEN_LABEL[reason]}</span>
      </Tooltip>
    );
  }

  const suffix = FINANCIAL_MODE_SUFFIX[projection.mode] ?? null;

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
