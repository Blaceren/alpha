"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";
import type { VisibilityState } from "@tanstack/react-table";
import type { CrmDataProvider } from "@/data/contracts/CrmDataProvider";
import { useUsersQuery } from "./hooks/use-users-query";
import { useColumnVisibility } from "./hooks/use-column-visibility";
import { UsersSummary } from "./users-summary";
import { UsersToolbar } from "./users-toolbar";
import { UsersTable } from "./users-table";
import { UsersPagination } from "./users-pagination";
import {
  UsersEmptyDataset,
  UsersError,
  UsersNoResults,
  UsersTableSkeleton,
  UsersUnauthorized,
} from "./users-states";

/**
 * `providerOverride` is for tests only; production uses the app provider.
 *
 * `searchDebounceMs` is a TEST SEAM WITH A REASON, not a convenience. The search
 * box debounces on a real 300 ms timer, so any assertion about a search result
 * has to sit through 300 ms of wall clock before the work it is actually waiting
 * for even begins — on top of a jsdom re-render of a table that renders twice
 * because Tailwind's responsive classes do not apply there. Measured on an idle
 * machine that assertion took 782 ms against `waitFor`'s 1000 ms budget, and
 * under parallel workers it took 1152 ms and failed. The debounce is not what
 * those tests are about; a test that is about it sets a real value here.
 *
 * Production passes nothing and gets 300 ms, unchanged.
 */
export function UsersWorkspace({
  providerOverride,
  searchDebounceMs,
}: {
  providerOverride?: CrmDataProvider;
  searchDebounceMs?: number;
}) {
  const q = useUsersQuery(providerOverride, searchDebounceMs);
  const { visible, toggle } = useColumnVisibility();

  const columnVisibility = React.useMemo<VisibilityState>(() => ({ ...visible }), [visible]);

  const result = q.result;
  const total = result?.data?.page.total ?? null;
  const items = result?.data?.items ?? [];
  const hasQueryOrFilters = q.activeFilterCount > 0 || q.search.trim().length > 0;

  return (
    <div className="space-y-4">
      <UsersSummary total={total} activeFilterCount={q.activeFilterCount} freshness={result?.freshness ?? null} />

      <UsersToolbar
        search={q.search}
        onSearch={q.setSearch}
        filters={q.state.filters}
        setFilters={q.setFilters}
        clearFilter={q.clearFilter}
        resetFilters={q.resetFilters}
        activeFilterCount={q.activeFilterCount}
        columnVisible={visible}
        onToggleColumn={toggle}
      />

      {result?.status === "stale" ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          <TriangleAlert className="h-4 w-4" aria-hidden />
          Данные могли устареть. Таблица показывает последний известный результат.
        </div>
      ) : null}

      {!result || (q.loading && !result) ? (
        <UsersTableSkeleton />
      ) : result.status === "error" ? (
        result.error?.code === "unauthorized" ? (
          <UsersUnauthorized />
        ) : (
          <UsersError error={result.error} onRetry={q.retry} />
        )
      ) : items.length === 0 ? (
        hasQueryOrFilters ? (
          <UsersNoResults onReset={q.resetFilters} />
        ) : (
          <UsersEmptyDataset />
        )
      ) : (
        <>
          <UsersTable
            users={items}
            columnVisibility={columnVisibility}
            sort={q.state.sort}
            onSort={q.setSort}
          />
          <UsersPagination
            total={total ?? items.length}
            pageIndex={q.state.pageIndex}
            pageSize={q.state.pageSize}
            onPageIndex={q.setPageIndex}
            onPageSize={q.setPageSize}
          />
        </>
      )}
    </div>
  );
}
