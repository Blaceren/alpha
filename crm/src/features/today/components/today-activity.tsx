import * as React from "react";
import type { TodayQueueItem } from "@/domain/today/today";
import { TODAY_LABEL } from "@/config/labels";
import { formatRelativeTime } from "@/lib/format";
import { displayNowMs } from "@/features/users/lib/display-clock";

/**
 * Activity, on the two axes the builder keeps apart (§21):
 *  - `todayEvent` — did anything happen inside today's window;
 *  - `lastActivityAt` — the last meaningful action, however old.
 * A user can be silent today and still be the day's most urgent work, so the
 * two are never collapsed into one "active/inactive" flag.
 */
export function TodayActivity({ item }: { item: TodayQueueItem }) {
  return (
    <span className="min-w-0 text-2xs text-text-muted">
      {item.todayEvent ? (
        <>
          <span className="text-text-secondary">{TODAY_LABEL.todayEvent}:</span>{" "}
          <span className="text-text-secondary">{item.todayEvent.title}</span>
        </>
      ) : item.lastActivityAt ? (
        <>{formatRelativeTime(item.lastActivityAt, displayNowMs())}</>
      ) : (
        TODAY_LABEL.noActivity
      )}
    </span>
  );
}
