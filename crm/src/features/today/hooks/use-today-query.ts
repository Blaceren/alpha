"use client";

import * as React from "react";
import type { CrmDataProvider, GetTodayInput } from "@/data/contracts/CrmDataProvider";
import type { Result } from "@/data/contracts/result";
import type { TodayWorkspace, TodaySortField } from "@/domain/today/today";
import type { TodayFilters } from "@/domain/today/today-query";
import { getCrmDataProvider } from "@/application/provider";
import { contextFromSession } from "@/application/context";
import { readDemoState, type DemoDataState } from "@/config/demo-state";
import { useSession } from "@/components/crm-shell/session-context";

const DEFAULT_SORT: TodaySortField = "urgency";

export interface UseTodayQuery {
  result: Result<TodayWorkspace> | null;
  loading: boolean;
  filters: TodayFilters;
  sort: TodaySortField;
  activeFilterCount: number;
  /** Raw (un-debounced) search text, for the controlled input. */
  search: string;
  setSearch: (v: string) => void;
  setFilters: (patch: Partial<TodayFilters>) => void;
  clearFilter: (key: keyof TodayFilters) => void;
  resetFilters: () => void;
  setSort: (sort: TodaySortField) => void;
  retry: () => void;
}

/** Filters that narrow the queue. `query` is counted separately (it has its own input). */
function countActiveFilters(f: TodayFilters): number {
  let n = 0;
  for (const [k, v] of Object.entries(f)) {
    if (k === "query") continue;
    if (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== "") n += 1;
  }
  return n;
}

/**
 * Owns Today's query state and calls the CrmDataProvider — never fixtures, and
 * never a second copy of the filter rules: the provider decides what a filter
 * means, this only carries the choice.
 *
 * `providerOverride` exists for tests; production uses getCrmDataProvider().
 */
export function useTodayQuery(providerOverride?: CrmDataProvider, searchDebounceMs = 300): UseTodayQuery {
  const { session } = useSession();

  // Dev-only data-state switch. Read after mount, never during render: the
  // server has no localStorage, so reading it inline would make the first client
  // render disagree with the server's HTML (hydration mismatch).
  const [demoState, setDemoState] = React.useState<DemoDataState>("default");
  React.useEffect(() => setDemoState(readDemoState()), []);

  const provider = React.useMemo(
    () => providerOverride ?? getCrmDataProvider(demoState),
    [providerOverride, demoState],
  );

  const [rawSearch, setRawSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [filters, setFiltersState] = React.useState<TodayFilters>({});
  const [sort, setSortState] = React.useState<TodaySortField>(DEFAULT_SORT);
  const [result, setResult] = React.useState<Result<TodayWorkspace> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(rawSearch), searchDebounceMs);
    return () => clearTimeout(t);
  }, [rawSearch, searchDebounceMs]);

  /**
   * Changing role re-runs this effect (session is a dependency), so the queue is
   * rebuilt from scratch for the new role. A search string typed against the old
   * role's identity projection is dropped rather than re-applied: it could name
   * a person the new role may not see, and matching it would answer a question
   * the projection is meant to refuse (§24).
   */
  const roleRef = React.useRef(session.role);
  React.useEffect(() => {
    if (roleRef.current !== session.role) {
      roleRef.current = session.role;
      setRawSearch("");
      setDebouncedSearch("");
    }
  }, [session.role]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const input: GetTodayInput = {
      filters: { ...filters, query: debouncedSearch.trim() || undefined },
      sort,
    };
    provider.getTodayWorkspace(contextFromSession(session), input).then((res) => {
      if (cancelled) return;
      setResult(res);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [provider, session, filters, sort, debouncedSearch, nonce]);

  const setFilters = React.useCallback((patch: Partial<TodayFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...patch }));
  }, []);

  const clearFilter = React.useCallback((key: keyof TodayFilters) => {
    setFiltersState((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const resetFilters = React.useCallback(() => {
    setFiltersState({});
    setRawSearch("");
    setDebouncedSearch("");
  }, []);

  return {
    result,
    loading,
    filters,
    sort,
    activeFilterCount: countActiveFilters(filters),
    search: rawSearch,
    setSearch: setRawSearch,
    setFilters,
    clearFilter,
    resetFilters,
    setSort: setSortState,
    retry: () => setNonce((n) => n + 1),
  };
}
