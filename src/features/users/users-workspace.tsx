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

/** `providerOverride` is for tests only; production uses the app provider. */
export function UsersWorkspace({ providerOverride }: { providerOverride?: CrmDataProvider }) {
  const q = useUsersQuery(providerOverride);
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
