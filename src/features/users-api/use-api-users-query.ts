"use client";

import * as React from "react";
import type { CrmApiUser } from "@/data/contracts/api/users";
import type { UsersOutcome } from "@/application/api/users-client";
import { USERS_DEFAULT_LIMIT, USERS_MAX_SEARCH_LENGTH } from "@/application/api/users-client";
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
}

export const EMAIL_SEARCH_UNAVAILABLE =
  "Поиск по email недоступен для вашей роли. Введите имя.";
export const SEARCH_TOO_LONG = `Не больше ${USERS_MAX_SEARCH_LENGTH} символов.`;

/**
 * Owns all production users-list query state: applied search, the cursor
 * history stack, and the in-flight request.
 *
 * Pagination is cursor-only. `cursorStack` is client memory for "Предыдущая"
 * (the backend has no previous cursor); it is never persisted, never decoded and
 * never shown. There is no total, so there is no page count — only a 1-based
 * position for orientation.
 */
export function useApiUsersQuery(options: UseApiUsersQueryOptions): UseApiUsersQuery {
  const { canSearchEmail, limit = USERS_DEFAULT_LIMIT } = options;

  const provider = React.useMemo(
    () => options.provider ?? createApiCrmDataProvider(),
    [options.provider],
  );

  const [searchInput, setSearchInput] = React.useState("");
  const [appliedSearch, setAppliedSearch] = React.useState("");
  const [localSearchError, setLocalSearchError] = React.useState<string | null>(null);

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

  React.useEffect(() => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;

    const controller = new AbortController();
    let cancelled = false;

    setState((prev) => (prev.kind === "ready" ? { kind: "retrying" } : { kind: "loading" }));
    inFlight.current = true;

    void provider
      .listUsers(
        { limit, cursor, search: appliedSearch || undefined },
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
  }, [provider, limit, cursor, appliedSearch, nonce]);

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
    // A new search invalidates the cursor history entirely.
    setCursorStack([null]);
    setAppliedSearch(trimmed);
  }, [searchInput, canSearchEmail]);

  const clearSearch = React.useCallback(() => {
    setSearchInput("");
    setLocalSearchError(null);
    setCursorStack([null]);
    setAppliedSearch("");
  }, []);

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
    nextPage,
    previousPage,
    retry,
    canGoPrevious: cursorStack.length > 1,
    canGoNext: state.kind === "ready" && state.nextCursor !== null,
    pageNumber: cursorStack.length,
  };
}
