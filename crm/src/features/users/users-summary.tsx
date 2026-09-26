import * as React from "react";
import { StaleDataIndicator } from "@/components/states/stale-data-indicator";
import type { Freshness } from "@/domain/shared/primitives";

interface SummaryProps {
  total: number | null;
  activeFilterCount: number;
  freshness: Freshness | null;
}

/** Compact operational header — no charts, no KPI cards, no fake metrics. */
export function UsersSummary({ total, activeFilterCount, freshness }: SummaryProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border pb-3">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Пользователи</h1>
        <p className="mt-0.5 text-sm text-text-secondary">
          {total ?? "—"} {total === 1 ? "результат" : "результатов"}
          {activeFilterCount > 0 ? ` · фильтров: ${activeFilterCount}` : ""}
          {" · "}сначала идентичность и причина внимания, затем состояния.
        </p>
      </div>
      {freshness ? (
        freshness.isStale ? (
          <StaleDataIndicator asOf={freshness.asOf} />
        ) : (
          <span className="text-2xs text-text-muted">актуально</span>
        )
      ) : null}
    </div>
  );
}
