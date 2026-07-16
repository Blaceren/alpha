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
import { nameFor } from "./today-queue-item";

/**
 * Mobile representation of a queue row.
 *
 * A transformation, not a squeezed table: the desktop row's columns become a
 * vertical read — priority and deadline first (is this mine, now?), then who and
 * why, then the recommendation — with a full-width action at the bottom where a
 * thumb reaches. Every field of the desktop row survives; none is behind a
 * horizontal scroll or a tooltip (§17).
 */
export function TodayMobileCard({ item }: { item: TodayQueueItem }) {
  return (
    <li>
      <article className="rounded-lg border border-border bg-surface p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <TodayPriority priority={item.priority} />
          <TodayDueChip due={item.due} />
        </div>

        <div className="mt-2 min-w-0">
          <TodayIdentity item={item} />
          <TodayReason item={item} />
          <TodayNextStep item={item} />
          <div className="mt-1">
            <TodayActivity item={item} />
          </div>
        </div>

        <Link
          href={`/users/${item.userId}`}
          className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded border border-border bg-background px-3 text-xs font-medium text-text-primary transition-colors hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {`${TODAY_LABEL.openProfile}`}
          <span className="sr-only">{`: ${nameFor(item)}`}</span>
          <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      </article>
    </li>
  );
}
