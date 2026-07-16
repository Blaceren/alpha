import * as React from "react";
import { TriangleAlert } from "lucide-react";
import type { TodayFreshness } from "@/domain/today/today";
import { formatExactTime } from "@/lib/format";


/**
 * How current the board is.
 *
 * `ageMinutes` is computed by the PROVIDER against its own clock — this
 * component never calls `Date.now()`, which is what keeps the marker
 * deterministic under FixedMockClock and identical on server and client (§20).
 */
export function TodayFreshnessMarker({ freshness }: { freshness: TodayFreshness }) {
  // When the data IS stale the banner says so, with the age and what it means.
  // Repeating "обновлено 75 мин назад" up here would print one fact twice (§10),
  // so the marker only speaks when there is no banner to speak for it.
  if (freshness.isStale) return null;
  return <span className="text-2xs text-text-muted">актуально · {formatExactTime(freshness.generatedAt)}</span>;
}

/**
 * The stale banner. Unobtrusive by design: the queue stays fully readable and
 * usable, because slightly old work is still the work. It states the age rather
 * than just "устарело", so an operator can judge whether it matters.
 */
export function TodayStaleBanner({ freshness }: { freshness: TodayFreshness }) {
  if (!freshness.isStale) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
    >
      <TriangleAlert aria-hidden className="h-4 w-4 shrink-0" />
      <span>
        Данные обновлены {freshness.ageMinutes} мин назад и могли устареть. Очередь показывает последний
        известный результат.
      </span>
    </div>
  );
}
