"use client";

import * as React from "react";
import type { CrmDataProvider } from "@/data/contracts/CrmDataProvider";
import { useSession } from "@/components/crm-shell/session-context";
import { useTodayQuery } from "./hooks/use-today-query";
import { TodayHeader } from "./components/today-header";
import { TodayToolbar } from "./components/today-toolbar";
import { TodayQueueSectionBlock } from "./components/today-queue-section";
import { TodayStaleBanner } from "./components/today-freshness";
import {
  TodayEmptyDataset,
  TodayError,
  TodayNoAccess,
  TodayNoResults,
  TodayNoWork,
  TodaySkeleton,
} from "./today-states";

/**
 * Read-only Today workspace (Phase 1B3).
 *
 * Everything on screen was decided by the provider: who is in the queue, why,
 * how urgent, and what this role may see. This component chooses a layout and
 * renders — it derives no priority, applies no permission rule, and offers no
 * mutation. `providerOverride` is for tests only.
 */
export function TodayWorkspace({
  providerOverride,
  searchDebounceMs,
}: {
  providerOverride?: CrmDataProvider;
  /** Test seam. See `UsersWorkspace` for why it exists and what it costs. */
  searchDebounceMs?: number;
}) {
  const q = useTodayQuery(providerOverride, searchDebounceMs);
  const { session } = useSession();

  const result = q.result;
  const ws = result?.data ?? null;

  // First load has no data yet — show the skeleton rather than an empty board.
  if (!result || (q.loading && !ws)) return <TodaySkeleton />;

  if (result.status === "error") {
    if (result.error?.code === "unauthorized") return <TodayNoAccess />;
    return (
      <div className="space-y-4">
        {/* The page keeps its single h1, but claims no working date: the read
            failed, so the provider never told us what day the data is for. */}
        <TodayHeader generatedAt={null} role={session.role} summary={null} freshness={null} />
        <TodayError error={result.error} onRetry={q.retry} />
      </div>
    );
  }

  if (!ws) return <TodaySkeleton />;

  const hasFiltersApplied = q.activeFilterCount > 0 || q.search.trim().length > 0;
  const isEmpty = ws.sections.length === 0;

  return (
    <div className="space-y-4">
      <TodayHeader
        generatedAt={ws.generatedAt}
        role={ws.role}
        summary={ws.summary}
        freshness={ws.freshness}
      />

      <TodayStaleBanner freshness={ws.freshness} />

      <TodayToolbar
        options={ws.filterOptions}
        filters={q.filters}
        setFilters={q.setFilters}
        clearFilter={q.clearFilter}
        resetFilters={q.resetFilters}
        activeFilterCount={q.activeFilterCount}
        sort={q.sort}
        setSort={q.setSort}
        search={q.search}
        onSearch={q.setSearch}
        resultCount={ws.summary.totalAttention}
      />

      {isEmpty ? (
        // Three different facts, three different messages. "No access" is NOT
        // one of them: `/today` is visible to every role, so an empty queue is
        // never a permission story — only an `unauthorized` result is, and that
        // is handled above. Guessing otherwise told an admin they lacked rights
        // to a database that was simply empty.
        hasFiltersApplied ? (
          <TodayNoResults onReset={q.resetFilters} />
        ) : ws.hasCalmUsers ? (
          <TodayNoWork />
        ) : (
          <TodayEmptyDataset />
        )
      ) : (
        <div className="space-y-4">
          {ws.sections.map((section) => (
            <TodayQueueSectionBlock key={section.key} section={section} />
          ))}
        </div>
      )}
    </div>
  );
}
