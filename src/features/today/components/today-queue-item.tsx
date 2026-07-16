import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { TodayQueueItem } from "@/domain/today/today";
import { TODAY_LABEL } from "@/config/labels";
import { TodayPriority } from "./today-priority";
import { TodayDueChip } from "./today-due-chip";
import { TodayReason } from "./today-reason";
import { TodayIdentity } from "./today-identity";
import { TodayNextStep } from "./today-next-step";
import { TodayActivity } from "./today-activity";

/** The name this role is allowed to hear. Never invents one. */
export function nameFor(item: TodayQueueItem): string {
  return item.identity.displayName ?? item.identity.pseudonymId ?? item.userId;
}

/**
 * One queue row (tablet + desktop). A list item, not a table row: Today reads
 * down each row as "who → why → what next", where the Users table reads across
 * as columns of state. Same underlying user, different question.
 */
export function TodayQueueItemRow({ item }: { item: TodayQueueItem }) {
  return (
    <li className="border-b border-border last:border-0">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 px-3 py-2.5 transition-colors hover:bg-row-hover lg:grid-cols-[7rem_minmax(0,1fr)_10.5rem_auto]">
        {/* Priority — always carries its text label, never colour alone. */}
        <div className="pt-0.5">
          <TodayPriority priority={item.priority} />
        </div>

        {/* Who, why, and what the domain recommends. */}
        <div className="min-w-0">
          <TodayIdentity item={item} />
          <TodayReason item={item} />
          <TodayNextStep item={item} />
        </div>

        {/* Deadline + activity: its own column from lg, inline below that. */}
        <div className="col-start-2 row-start-2 flex flex-wrap items-center gap-x-2 gap-y-1 lg:col-start-3 lg:row-start-1 lg:flex-col lg:items-start lg:gap-1 lg:pt-0.5">
          <TodayDueChip due={item.due} />
          <TodayActivity item={item} />
        </div>

        {/* Read-only navigation — the ONLY action a queue row offers. */}
        <div className="col-start-3 row-start-1 lg:col-start-4">
          <Link
            href={`/users/${item.userId}`}
            className="inline-flex h-8 items-center gap-1 rounded border border-border bg-surface px-2.5 text-xs font-medium text-text-primary transition-colors hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* The accessible name names the user, so a screen-reader user hears
                "Открыть профиль: Nina Chmiel" and not 22 identical links. */}
            <span className="sr-only">{`${TODAY_LABEL.openProfile}: ${nameFor(item)}`}</span>
            {/* Labelled from lg up: at 1024 the row action was a bare arrow, which
                reads as "next" rather than "open this person". */}
            <span aria-hidden className="hidden lg:inline">
              {TODAY_LABEL.openProfile}
            </span>
            <ArrowRight aria-hidden className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </li>
  );
}
