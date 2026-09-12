"use client";

import * as React from "react";
import type { CrmDataProvider, SearchUsersInput, UserFilters, UserSortField } from "@/data/contracts/CrmDataProvider";
import type { Paginated, Result } from "@/data/contracts/result";
import type { UserSummary } from "@/domain/users/user";
import { getCrmDataProvider } from "@/application/provider";
import { contextFromSession } from "@/application/context";
import { useSession } from "@/components/crm-shell/session-context";

export interface UsersQueryState {
  filters: UserFilters;
  sort: { field: UserSortField; dir: "asc" | "desc" };
  pageIndex: number;
  pageSize: number;
}

const DEFAULT_SORT: UsersQueryState["sort"] = { field: "priority", dir: "asc" };

export interface UseUsersQuery {
  result: Result<Paginated<UserSummary>> | null;
  loading: boolean;
  state: UsersQueryState;
  activeFilterCount: number;
  /** Raw (un-debounced) search input value, for the controlled input. */
  search: string;
  setSearch: (query: string) => void;
  setFilters: (patch: Partial<UserFilters>) => void;
  clearFilter: (key: keyof UserFilters) => void;
  resetFilters: () => void;
  setSort: (field: UserSortField) => void;
  setPageIndex: (i: number) => void;
  setPageSize: (n: number) => void;
  retry: () => void;
}

function countActiveFilters(f: UserFilters): number {
  let n = 0;
  for (const [k, v] of Object.entries(f)) {
    if (k === "query") continue;
    if (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== "") n += 1;
  }
  return n;
}

/**
 * Owns all Users query state and calls the CrmDataProvider (never fixtures).
 * Search is debounced; pagination resets on any search/filter change.
 * `providerOverride` exists only for tests — production uses getCrmDataProvider().
 */
export function useUsersQuery(providerOverride?: CrmDataProvider, searchDebounceMs = 300): UseUsersQuery {
  const { session } = useSession();
  const provider = React.useMemo(
    () => providerOverride ?? getCrmDataProvider(),
    [providerOverride],
  );

  const [rawSearch, setRawSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [filters, setFiltersState] = React.useState<UserFilters>({});
  const [sort, setSortState] = React.useState(DEFAULT_SORT);
  const [pageIndex, setPageIndex] = React.useState(0);
  const [pageSize, setPageSizeState] = React.useState(20);
  const [result, setResult] = React.useState<Result<Paginated<UserSummary>> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [nonce, setNonce] = React.useState(0);

  // Debounce free-text search; reset to first page when it changes.
  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(rawSearch);
      setPageIndex(0);
    }, searchDebounceMs);
    return () => clearTimeout(t);
  }, [rawSearch, searchDebounceMs]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const input: SearchUsersInput = {
      query: debouncedSearch.trim() || undefined,
      filters,
      sort,
      page: { cursor: pageIndex > 0 ? String(pageIndex * pageSize) : null, pageSize },
    };
    provider.searchUsers(contextFromSession(session), input).then((res) => {
      if (cancelled) return;
      setResult(res);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [provider, session, debouncedSearch, filters, sort, pageIndex, pageSize, nonce]);

  const setFilters = React.useCallback((patch: Partial<UserFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...patch }));
    setPageIndex(0);
  }, []);

  const clearFilter = React.useCallback((key: keyof UserFilters) => {
    setFiltersState((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setPageIndex(0);
  }, []);

  const resetFilters = React.useCallback(() => {
    setFiltersState({});
    setRawSearch("");
    setDebouncedSearch("");
    setPageIndex(0);
  }, []);

  const setSort = React.useCallback((field: UserSortField) => {
    setSortState((prev) =>
      prev.field === field ? { field, dir: prev.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" },
    );
    setPageIndex(0);
  }, []);

  const setPageSize = React.useCallback((n: number) => {
    setPageSizeState(n);
    setPageIndex(0);
  }, []);

  return {
    result,
    loading,
    state: { filters, sort, pageIndex, pageSize },
    activeFilterCount: countActiveFilters(filters),
    search: rawSearch,
    setSearch: setRawSearch,
    setFilters,
    clearFilter,
    resetFilters,
    setSort,
    setPageIndex,
    setPageSize,
    retry: () => setNonce((n) => n + 1),
  };
}
