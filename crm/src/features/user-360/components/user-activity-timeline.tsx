import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { ACTIVITY_SOURCE_LABEL, USER_360_LABEL } from "@/config/labels";
import { formatExactTime, formatRelativeTime } from "@/lib/format";
import type { User360Event } from "@/domain/users/user-360";
import { displayNowMs } from "@/features/users/lib/display-clock";
import { SectionCard } from "./section-card";

/** Newest events only — a short operational read, not an audit log. */
const MAX_EVENTS = 6;

/**
 * Short operational timeline built from events that exist in the read model.
 * Deliberately NOT the technical audit trail and not an infinite log: it answers
 * "what recently happened to this user" in a few lines. Semantic <ol>, so screen
 * readers get a real list. Events the role may not see never arrive here.
 */
export function UserActivityTimeline({ activity }: { activity: User360Event[] }) {
  const events = activity.slice(0, MAX_EVENTS);

  return (
    <SectionCard
      title={USER_360_LABEL.activity}
      aside={activity.length > MAX_EVENTS ? `последние ${MAX_EVENTS} из ${activity.length}` : undefined}
    >
      {events.length === 0 ? (
        <p className="text-xs text-text-muted">Событий пока нет.</p>
      ) : (
        <ol className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="flex items-baseline gap-2">
              <Tooltip content={formatExactTime(e.at)} side="top">
                <time
                  dateTime={e.at}
                  className="w-20 shrink-0 text-2xs tabular-nums text-text-muted"
                >
                  {formatRelativeTime(e.at, displayNowMs())}
                </time>
              </Tooltip>
              <span className="min-w-0 flex-1 text-xs text-text-primary">{e.title}</span>
              <Badge tone="neutral">{ACTIVITY_SOURCE_LABEL[e.source]}</Badge>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}
