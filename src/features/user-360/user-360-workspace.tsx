"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";
import type { CrmDataProvider } from "@/data/contracts/CrmDataProvider";
import { useUser360Query } from "./hooks/use-user-360-query";
import { User360Header } from "./components/user-360-header";
import { UserAttentionPanel } from "./components/user-attention-panel";
import { UserStateOverview } from "./components/user-state-overview";
import { UserBlockers } from "./components/user-blockers";
import { UserSignals } from "./components/user-signals";
import { UserLearningProgress } from "./components/user-learning-progress";
import { UserActivityTimeline } from "./components/user-activity-timeline";
import { UserFinancialSummary } from "./components/user-financial-summary";
import { UserOwnerContext } from "./components/user-owner-context";
import {
  User360Error,
  User360NotFound,
  User360Skeleton,
  User360Unauthorized,
} from "./user-360-states";

/**
 * Read-only User 360 (Phase 1C). One provider call returns the whole aggregate
 * already projected for the caller's role — this component makes no permission
 * decisions of its own and performs no mutations.
 *
 * Composition (DOM order = mobile order = reading order):
 *   header → attention → states → blockers → signals → learning → activity
 *   → financial → owner
 * On lg+ the last two become a narrower sticky operational-context column beside
 * the wide main column.
 *
 * `providerOverride` is for tests only; production uses the app provider.
 */
export function User360Workspace({
  userId,
  providerOverride,
}: {
  userId: string;
  providerOverride?: CrmDataProvider;
}) {
  const { result, loading, retry } = useUser360Query(userId, providerOverride);

  if (!result || (loading && !result)) return <User360Skeleton />;

  if (result.status === "error") {
    const code = result.error?.code;
    if (code === "not_found") return <User360NotFound userId={userId} />;
    if (code === "unauthorized") return <User360Unauthorized />;
    return <User360Error error={result.error} onRetry={retry} />;
  }

  const view = result.data;
  if (!view) return <User360NotFound userId={userId} />;

  return (
    <div className="space-y-4">
      <User360Header view={view} />

      {result.status === "stale" ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          Данные могли устареть. Показан последний известный снимок профиля.
        </div>
      ) : null}

      {/* No `items-start`: the aside must stretch to the row height, otherwise the
          sticky context column has no room to travel and just scrolls away. */}
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex min-w-0 flex-col gap-4 lg:w-2/3">
          <UserAttentionPanel view={view} />
          <UserStateOverview view={view} />
          {/* Blockers = state axis · Signals = derived indicators. Side by side on
              wide screens; stacked in the required order on mobile. */}
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            <UserBlockers view={view} />
            <UserSignals view={view} />
          </div>
          <UserLearningProgress view={view} />
          <UserActivityTimeline activity={view.activity} />
        </div>

        <aside className="flex min-w-0 flex-col gap-4 lg:w-1/3">
          {/* Context stays in view while the main column scrolls. */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-0">
            <UserFinancialSummary view={view} />
            <UserOwnerContext view={view} />
          </div>
        </aside>
      </div>
    </div>
  );
}
