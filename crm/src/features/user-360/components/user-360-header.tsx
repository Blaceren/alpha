import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Clock } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip } from "@/components/ui/tooltip";
import type { BadgeProps } from "@/components/ui/badge";
import { PRIORITY_LABEL, USER_360_LABEL, ownerLabel } from "@/config/labels";
import { formatExactTime, formatRelativeTime } from "@/lib/format";
import type { PriorityBand } from "@/domain/priority/priority";
import type { User360 } from "@/domain/users/user-360";
import { displayNowMs } from "@/features/users/lib/display-clock";
import { UserIdentitySummary } from "./user-identity-summary";

const PRIORITY_TONE: Record<PriorityBand, NonNullable<BadgeProps["tone"]>> = {
  critical: "danger",
  high: "warning",
  normal: "info",
  low: "neutral",
};

function initials(name: string | null): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/**
 * Compact operational header — deliberately not a hero. Carries: back link,
 * identity (as projected), user id, priority, owner, last activity, freshness.
 */
export function User360Header({ view }: { view: User360 }) {
  const p = view.identity.projection;
  const name = p.mode === "hidden" ? null : p.displayName;
  const heading = name ?? p.pseudonymId ?? view.identity.userId;
  const lastAt = view.learning.lastMeaningfulActionAt;

  return (
    <header className="border-b border-border pb-3">
      <Link
        href="/users"
        className="mb-2 inline-flex items-center gap-1 rounded-sm text-2xs text-text-muted hover:text-text-secondary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden />
        {USER_360_LABEL.backToUsers}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar initials={initials(name)} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-semibold text-text-primary">{heading}</h1>
              <StatusBadge
                tone={PRIORITY_TONE[view.attention.priority]}
                label={PRIORITY_LABEL[view.attention.priority]}
              />
            </div>
            <UserIdentitySummary identity={view.identity} />
          </div>
        </div>

        {/* Secondary operational meta — quiet, right-aligned on wide screens. */}
        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs">
          <div className="flex items-center gap-1">
            <dt className="text-text-muted">{USER_360_LABEL.userId}</dt>
            <dd className="font-mono text-text-secondary">{view.identity.userId}</dd>
          </div>
          <div className="flex items-center gap-1">
            <dt className="text-text-muted">Ответственный</dt>
            <dd className="text-text-secondary">{ownerLabel(view.owner.ownerId)}</dd>
          </div>
          <div className="flex items-center gap-1">
            <dt className="text-text-muted">Последняя активность</dt>
            <dd className="text-text-secondary">
              {lastAt ? (
                <Tooltip content={formatExactTime(lastAt)} side="bottom">
                  <span>{formatRelativeTime(lastAt, displayNowMs())}</span>
                </Tooltip>
              ) : (
                "нет активности"
              )}
            </dd>
          </div>
          <div className="flex items-center gap-1">
            <dt className="text-text-muted">Данные</dt>
            <dd
              className={
                view.financial.freshness.isStale
                  ? "inline-flex items-center gap-1 text-warning"
                  : "text-text-secondary"
              }
            >
              {view.financial.freshness.isStale ? (
                <>
                  <Clock className="h-3 w-3" aria-hidden />
                  устарели
                </>
              ) : (
                "актуальны"
              )}
            </dd>
          </div>
        </dl>
      </div>
    </header>
  );
}
