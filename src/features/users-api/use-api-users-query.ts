"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import type { CrmApiUser } from "@/data/contracts/api/users";
import type { UsersOutcome } from "@/application/api/users-client";
import { USERS_DEFAULT_LIMIT, USERS_MAX_SEARCH_LENGTH } from "@/application/api/users-client";
import {
  buildOwnerSearch,
  readOwnerFilter,
  type CrmUsersOwnerFilter,
} from "@/application/api/users-owner-filter";
import { createApiCrmDataProvider, type CrmUsersReadCapability } from "@/data/api/api-crm-data-provider";

export type ApiUsersViewState =
  | { kind: "loading" }
  | { kind: "retrying" }
  | { kind: "ready"; items: CrmApiUser[]; nextCursor: string | null }
  | { kind: "invalid_input"; requestId?: string }
  | { kind: "unauthenticated" }
  | { kind: "forbidden"; requestId?: string }
  | { kind: "upstream_unavailable" }
  | { kind: "malformed" };

function outcomeToState(outcome: UsersOutcome): ApiUsersViewState {
  switch (outcome.status) {
    case "success":
      return { kind: "ready", items: outcome.page.items, nextCursor: outcome.page.nextCursor };
    case "invalid_input":
      return { kind: "invalid_input", requestId: outcome.requestId };
    case "unauthenticated":
      return { kind: "unauthenticated" };
    case "forbidden":
      return { kind: "forbidden", requestId: outcome.requestId };
    case "upstream_unavailable":
      return { kind: "upstream_unavailable" };
    case "malformed_response":
      return { kind: "malformed" };
  }
}

export interface UseApiUsersQuery {
  state: ApiUsersViewState;
  /** Raw controlled input value. */
  searchInput: string;
  setSearchInput: (value: string) => void;
  /** The search actually applied to the current page. */
  appliedSearch: string;
  /** Local, pre-flight complaint about the input — never a backend message. */
  localSearchError: string | null;
  submitSearch: () => void;
  clearSearch: () => void;
  /** The applied owner filter — always exactly one of the three states. */
  ownerFilter: CrmUsersOwnerFilter;
  /** Select an owner filter: resets pagination, keeps search, mirrors to the URL. */
  setOwnerFilter: (next: CrmUsersOwnerFilter) => void;
  nextPage: () => void;
  previousPage: () => void;
  retry: () => void;
  canGoPrevious: boolean;
  canGoNext: boolean;
  pageNumber: number;
}

export interface UseApiUsersQueryOptions {
  /** True when the session holds view_identity_full_email. */
  canSearchEmail: boolean;
  provider?: CrmUsersReadCapability;
  limit?: number;
  /**
   * The authenticated employee id. Used ONLY to detect a session-actor change so
   * the list resets and refetches for the new employee; it is never sent to the
   * backend (the backend resolves `mine` from the session itself) and never
   * appears in the URL or DOM.
   */
  sessionEmployeeId?: string;
}

export const EMAIL_SEARCH_UNAVAILABLE =
  "Поиск по email недоступен для вашей роли. Введите имя.";
export const SEARCH_TOO_LONG = `Не больше ${USERS_MAX_SEARCH_LENGTH} символов.`;

/** Read the current owner filter from the browser URL, failing safe to `all`. */
function ownerFromLocation(): CrmUsersOwnerFilter {
  const search = typeof window === "undefined" ? "" : window.location.search;
  return readOwnerFilter(new URLSearchParams(search));
}

/**
 * Owns all production users-list query state: applied search, the applied owner
 * filter (URL-backed), the cursor history stack, and the in-flight request.
 *
 * Pagination is cursor-only. `cursorStack` is client memory for "Предыдущая"
 * (the backend has no previous cursor); it is never persisted, never decoded and
 * never shown. There is no total, so there is no page count — only a 1-based
 * position for orientation.
 *
 * The owner filter is the URL's single source of shareable state (`?owner=mine`
 * / `?owner=unassigned`; omitted for `all`). Changing it, or a browser
 * back/forward that changes it, resets the cursor stack to the first page while
 * preserving the current search. No localStorage / sessionStorage / cookie is
 * ever used for it.
 */
export function useApiUsersQuery(options: UseApiUsersQueryOptions): UseApiUsersQuery {
  const { canSearchEmail, limit = USERS_DEFAULT_LIMIT, sessionEmployeeId } = options;

  const router = useRouter();
  const pathname = usePathname();

  const provider = React.useMemo(
    () => options.provider ?? createApiCrmDataProvider(),
    [options.provider],
  );

  const [searchInput, setSearchInput] = React.useState("");
  const [appliedSearch, setAppliedSearch] = React.useState("");
  const [localSearchError, setLocalSearchError] = React.useState<string | null>(null);

  // Initialized from the URL so a refreshed/shared `?owner=mine` link restores.
  const [ownerFilter, setOwnerFilterState] = React.useState<CrmUsersOwnerFilter>(ownerFromLocation);
  // Latest applied filter, readable from event handlers (popstate) without
  // re-subscribing the listener on every change.
  const ownerRef = React.useRef(ownerFilter);
  ownerRef.current = ownerFilter;

  // cursorStack[i] is the cursor that produced page i. Index 0 is null (first
  // page), so the stack length is the current 1-based page number.
  const [cursorStack, setCursorStack] = React.useState<(string | null)[]>([null]);
  const [state, setState] = React.useState<ApiUsersViewState>({ kind: "loading" });
  const [nonce, setNonce] = React.useState(0);

  const cursor = cursorStack[cursorStack.length - 1] ?? null;

  // Guards a retry against being started twice, and lets the effect drop a
  // superseded response instead of letting it overwrite a newer one.
  const inFlight = React.useRef(false);
  const requestSeq = React.useRef(0);

  // Canonicalize the incoming URL exactly once: strip an explicit `owner=all`,
  // any repeated `owner`, or a garbage value, using `replace` so it adds no
  // history entry. A well-formed `?owner=mine` is already canonical and is left
  // untouched (no redundant rewrite).
  const canonicalizedRef = React.useRef(false);
  React.useEffect(() => {
    if (canonicalizedRef.current || typeof window === "undefined") return;
    canonicalizedRef.current = true;
    const current = window.location.search === "?" ? "" : window.location.search;
    const desired = buildOwnerSearch(new URLSearchParams(current), ownerFilter);
    if (desired !== current) router.replace(`${pathname}${desired}`);
  }, [ownerFilter, pathname, router]);

  // Browser back/forward: re-derive the filter from the URL and reset pagination
  // if it changed. State is derived from the URL, never from storage.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = () => {
      const next = ownerFromLocation();
      if (ownerRef.current === next) return;
      // Both updates in one handler batch into a single render → one refetch.
      setCursorStack([null]);
      setOwnerFilterState(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // A session-actor change clears rows and pagination and refetches for the new
  // employee using the current owner/search state.
  const employeeRef = React.useRef(sessionEmployeeId);
  React.useEffect(() => {
    if (employeeRef.current === sessionEmployeeId) return;
    employeeRef.current = sessionEmployeeId;
    setCursorStack([null]);
    setState({ kind: "loading" });
    setNonce((n) => n + 1);
  }, [sessionEmployeeId]);

  React.useEffect(() => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;

    const controller = new AbortController();
    let cancelled = false;

    setState((prev) => (prev.kind === "ready" ? { kind: "retrying" } : { kind: "loading" }));
    inFlight.current = true;

    void provider
      .listUsers(
        { limit, cursor, search: appliedSearch || undefined, owner: ownerFilter },
        { signal: controller.signal },
      )
      .then((outcome) => {
        // A stale response must never replace a newer result.
        if (cancelled || requestSeq.current !== seq) return;
        setState(outcomeToState(outcome));
      })
      .finally(() => {
        if (requestSeq.current === seq) inFlight.current = false;
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [provider, limit, cursor, appliedSearch, ownerFilter, nonce]);

  const submitSearch = React.useCallback(() => {
    const trimmed = searchInput.trim();

    if (trimmed.length > USERS_MAX_SEARCH_LENGTH) {
      setLocalSearchError(SEARCH_TOO_LONG);
      return;
    }
    // Refuse email-shaped input locally when the session cannot search email.
    // The backend enforces this too and stays authoritative; refusing here just
    // avoids a pointless round trip and says why in CRM copy.
    if (trimmed.includes("@") && !canSearchEmail) {
      setLocalSearchError(EMAIL_SEARCH_UNAVAILABLE);
      return;
    }

    setLocalSearchError(null);
    // A new search invalidates the cursor history entirely; the owner filter is
    // preserved.
    setCursorStack([null]);
    setAppliedSearch(trimmed);
  }, [searchInput, canSearchEmail]);

  const clearSearch = React.useCallback(() => {
    setSearchInput("");
    setLocalSearchError(null);
    setCursorStack([null]);
    setAppliedSearch("");
  }, []);

  const setOwnerFilter = React.useCallback(
    (next: CrmUsersOwnerFilter) => {
      if (ownerRef.current === next) return;
      // Reset pagination and apply the new filter in one batch (single refetch),
      // preserving the current search. The URL is a `push` so browser back/
      // forward restores the previous filter.
      setCursorStack([null]);
      setOwnerFilterState(next);
      const current = typeof window === "undefined" ? "" : window.location.search;
      router.push(`${pathname}${buildOwnerSearch(new URLSearchParams(current), next)}`);
    },
    [router, pathname],
  );

  const nextPage = React.useCallback(() => {
    if (inFlight.current) return;
    // Read the cursor from current state directly. Queuing another setState
    // from inside a state updater would be an impure updater — React may run it
    // twice or discard the effect.
    if (state.kind !== "ready" || !state.nextCursor) return;
    const next = state.nextCursor;
    setCursorStack((stack) => [...stack, next]);
  }, [state]);

  const previousPage = React.useCallback(() => {
    if (inFlight.current) return;
    setCursorStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack));
  }, []);

  const retry = React.useCallback(() => {
    if (inFlight.current) return;
    setNonce((n) => n + 1);
  }, []);

  return {
    state,
    searchInput,
    setSearchInput,
    appliedSearch,
    localSearchError,
    submitSearch,
    clearSearch,
    ownerFilter,
    setOwnerFilter,
    nextPage,
    previousPage,
    retry,
    canGoPrevious: cursorStack.length > 1,
    canGoNext: state.kind === "ready" && state.nextCursor !== null,
    pageNumber: cursorStack.length,
  };
}
