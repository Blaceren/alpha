"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";
import type { CrmDataProvider } from "@/data/contracts/CrmDataProvider";
import type { CrmMutations } from "@/data/contracts/CrmMutations";
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
import { UserNotes } from "./components/user-notes";
import {
  User360Error,
  User360NotFound,
  User360Skeleton,
  User360Unauthorized,
} from "./user-360-states";

/**
 * User 360. One provider call returns the whole aggregate already projected for
 * the caller's role — this component makes no permission decisions of its own.
 *
 * Composition (DOM order = mobile order = reading order):
 *   header → attention → states → blockers → signals → learning → activity
 *   → notes → financial → owner
 * On lg+ the last two become a narrower sticky operational-context column beside
 * the wide main column.
 *
 * Notes (Phase 1B4-B) are the one part not served by the aggregate: they carry a
 * per-note privacy rule with its own canonical projector, so they keep their own
 * permission-aware read and their own local states.
 *
 * Owner assignment (Phase 1B4-C) is served BY the aggregate and refetches it whole.
 * Only the candidate list is a read of its own, because it is not about this user.
 * The rest of the screen stays read-only — recommendations still offer no action
 * control.
 *
 * `providerOverride` / `mutationsOverride` are for tests only; production uses
 * the app's single provider instance for both halves of the boundary.
 */
export function User360Workspace({
  userId,
  providerOverride,
  mutationsOverride,
}: {
  userId: string;
  providerOverride?: CrmDataProvider;
  mutationsOverride?: CrmMutations;
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
          {/* Notes sit after the timeline: recent events are what the profile
              observed, notes are what the team wrote about it. */}
          <UserNotes
            userId={userId}
            providerOverride={providerOverride}
            mutationsOverride={mutationsOverride}
          />
        </div>

        <aside className="flex min-w-0 flex-col gap-4 lg:w-1/3">
          {/* Context stays in view while the main column scrolls. */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-0">
            <UserFinancialSummary view={view} />
            {/* Owner assignment refetches the WHOLE aggregate: the owner is part of
                `getUser360`, which is the screen's single read (D-35), so there is
                no narrower re-read to give it without inventing a second owner
                source that could disagree with the first. */}
            <UserOwnerContext
              view={view}
              onOwnerAssigned={retry}
              providerOverride={providerOverride}
              mutationsOverride={mutationsOverride}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
