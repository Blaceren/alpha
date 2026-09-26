import * as React from "react";
import { Clock } from "lucide-react";
import type { FinancialProjection } from "@/domain/financial/projection";
import { FINANCIAL_HIDDEN_LABEL, FINANCIAL_HIDDEN_TOOLTIP, FINANCIAL_MODE_SUFFIX } from "@/config/labels";
import { Tooltip } from "@/components/ui/tooltip";

/**
 * The balance, when the row's basis is about money (checkpoint / data quality).
 *
 * A null projection means "not part of this row" and renders NOTHING — the
 * queue does not print a placeholder for a value it never asked for. When a
 * projection IS present it is rendered exactly as the provider built it: exact,
 * bucket or aggregated, with its own honest reason when withheld. The UI makes
 * no visibility decision of its own.
 */
export function TodayBalance({ projection }: { projection: FinancialProjection | null }) {
  if (!projection) return null;

  if (projection.mode === "hidden") {
    const reason = projection.hiddenReason ?? "no_data";
    return (
      <Tooltip content={FINANCIAL_HIDDEN_TOOLTIP[reason]} side="top">
        <span className="text-2xs text-text-muted">
          Баланс: {FINANCIAL_HIDDEN_LABEL[reason]}
        </span>
      </Tooltip>
    );
  }

  const suffix = FINANCIAL_MODE_SUFFIX[projection.mode] ?? null;
  return (
    <span className="inline-flex items-center gap-1 text-2xs">
      <span className="text-text-muted">Баланс:</span>
      <span className="font-mono tabular-nums text-text-secondary">{projection.label}</span>
      {suffix ? <span className="text-text-muted">{suffix}</span> : null}
      {projection.stale ? (
        <Tooltip content="Данные устарели" side="top">
          <span className="inline-flex text-warning" aria-label="устарело">
            <Clock aria-hidden className="h-3 w-3" />
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}
