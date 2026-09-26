import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { USERS_COLUMN_LABEL } from "@/config/labels";
import { UserCell } from "./user-cell";
import { PriorityCell } from "./priority-cell";
import { EngagementBadge, FundingBadge, LifecycleBadge } from "./state-badges";
import { BlockersCell } from "./blockers-cell";
import { OwnerCell } from "./misc-cells";
import { LastActivityCell } from "./last-activity-cell";
import type { UserSummary } from "@/domain/users/user";

/** Mobile representation — same data as the desktop table, card layout. */
export function MobileUserCard({ user }: { user: UserSummary }) {
  return (
    <article className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <UserCell user={user} variant="card" />
        {user.priority ? (
          <PriorityCell priority={user.priority} reasonCode={user.priorityReasonCode} fullReason />
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        <LifecycleBadge value={user.lifecycleStage} />
        <FundingBadge value={user.fundingStatus} />
        <EngagementBadge value={user.engagementStatus} />
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-2xs">
        <div className="col-span-2">
          <dt className="sr-only">{USERS_COLUMN_LABEL.blockers}</dt>
          <dd>
            <BlockersCell blockers={user.blockers} variant="full" />
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">{USERS_COLUMN_LABEL.owner}</dt>
          <dd>
            <OwnerCell ownerId={user.ownerId} />
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">{USERS_COLUMN_LABEL.lastActivity}</dt>
          <dd>
            <LastActivityCell at={user.lastMeaningfulActionAt} />
          </dd>
        </div>
      </dl>

      <div className="mt-2">
        <Button asChild variant="secondary" size="sm">
          <Link href={`/users/${user.id}`} aria-label={`Открыть профиль ${user.displayName ?? user.id}`}>
            Открыть профиль
          </Link>
        </Button>
      </div>
    </article>
  );
}
