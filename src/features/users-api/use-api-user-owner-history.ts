"use client";

import * as React from "react";
import type { CrmApiOwnerHistoryItem } from "@/data/contracts/api/user-owner-history";
import type { OwnerHistoryListOutcome } from "@/application/api/user-owner-history-client";
import { isValidCrmUserId } from "@/data/contracts/api/user-id";
import { createApiCrmDataProvider, type CrmUsersReadCapability } from "@/data/api/api-crm-data-provider";

/**
 * Owns the production Owner History read for one learner.
 *
 * Read-only: history is immutable and append-only server-side, so there is no
 * create, update or delete here. Nothing is persisted — no localStorage, no
 * cache. A history list belongs to one learner under one employee session, and
 * both can change underneath us, so the first-page effect keys on both.
 */

export type OwnerHistoryListState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "invalid_input" }
  | { kind: "unauthenticated" }
  | { kind: "forbidden"; requestId?: string }
  | { kind: "not_found" }
  | { kind: "upstream_unavailable" }
  | { kind: "malformed" };

/** How many rows one page requests. Within the backend's 1..50 bound. */
export const OWNER_HISTORY_PAGE_SIZE = 20;

export interface UseApiUserOwnerHistory {
  items: CrmApiOwnerHistoryItem[];
  listState: OwnerHistoryListState;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  hasMore: boolean;
  loadMore: () => void;
  retryList: () => void;
}

export function useApiUserOwnerHistory(
  userId: string,
  canView: boolean,
  provider?: CrmUsersReadCapability,
  callbacks?: { onUnauthenticated?: () => void; onNotFound?: () => void },
  sessionKey?: string,
): UseApiUserOwnerHistory {
  const client = React.useMemo(() => provider ?? createApiCrmDataProvider(), [provider]);
  const validId = isValidCrmUserId(userId);

  const onUnauthenticated = callbacks?.onUnauthenticated;
  const onNotFound = callbacks?.onNotFound;

  const [items, setItems] = React.useState<CrmApiOwnerHistoryItem[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [listState, setListState] = React.useState<OwnerHistoryListState>(
    canView && validId ? { kind: "loading" } : { kind: "idle" },
  );
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = React.useState(false);
  const [nonce, setNonce] = React.useState(0);

  // A sequence guard so a superseded page response can never overwrite a newer
  // one (learner change, session change, retry).
  const listSeq = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);

  /* ------------------------------------------------------------ first page */

  React.useEffect(() => {
    // No permission, or an id the backend could never accept: never request.
    if (!canView || !validId) {
      setItems([]);
      setCursor(null);
      setListState({ kind: "idle" });
      return;
    }

    const seq = listSeq.current + 1;
    listSeq.current = seq;

    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;

    // Clear immediately: one learner's history must never be visible for a
    // moment under another learner's heading.
    setItems([]);
    setCursor(null);
    setLoadMoreFailed(false);
    setListState({ kind: "loading" });

    void client
      .listUserOwnerHistory(userId, { limit: OWNER_HISTORY_PAGE_SIZE }, { signal: controller.signal })
      .then((outcome: OwnerHistoryListOutcome) => {
        if (cancelled || listSeq.current !== seq) return;
        if (outcome.status === "success") {
          setItems(outcome.page.items);
          setCursor(outcome.page.nextCursor);
          setListState({ kind: "ready" });
          return;
        }
        setItems([]);
        setCursor(null);
        switch (outcome.status) {
          case "invalid_input":
            setListState({ kind: "invalid_input" });
            break;
          case "unauthenticated":
            setListState({ kind: "unauthenticated" });
            onUnauthenticated?.();
            break;
          case "forbidden":
            setListState({ kind: "forbidden", requestId: outcome.requestId });
            break;
          case "not_found":
            setListState({ kind: "not_found" });
            onNotFound?.();
            break;
          case "upstream_unavailable":
            setListState({ kind: "upstream_unavailable" });
            break;
          case "malformed_response":
            setListState({ kind: "malformed" });
            break;
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, userId, canView, validId, nonce, sessionKey, onUnauthenticated, onNotFound]);

  /* ------------------------------------------------------------- load more */

  const loadMore = React.useCallback(() => {
    // A second click while a page is in flight must not start a second request.
    if (!canView || !validId || cursor === null || loadingMore) return;

    const seq = listSeq.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);

    void client
      .listUserOwnerHistory(userId, { limit: OWNER_HISTORY_PAGE_SIZE, cursor })
      .then((outcome: OwnerHistoryListOutcome) => {
        if (listSeq.current !== seq) return;
        if (outcome.status === "success") {
          // Append only, preserving the server's order. Deduplication is
          // defensive: it drops a repeated historyId without reordering.
          setItems((prev) => {
            const seen = new Set(prev.map((h) => h.historyId));
            return [...prev, ...outcome.page.items.filter((h) => !seen.has(h.historyId))];
          });
          setCursor(outcome.page.nextCursor);
        } else if (outcome.status === "unauthenticated") {
          setListState({ kind: "unauthenticated" });
          onUnauthenticated?.();
        } else if (outcome.status === "not_found") {
          setListState({ kind: "not_found" });
          onNotFound?.();
        } else {
          // Keep every already-loaded row. A failed page is a failed page, not
          // a reason to discard what the employee is already reading.
          setLoadMoreFailed(true);
        }
      })
      .finally(() => {
        if (listSeq.current === seq) setLoadingMore(false);
      });
  }, [client, userId, canView, validId, cursor, loadingMore, onUnauthenticated, onNotFound]);

  const retryList = React.useCallback(() => setNonce((n) => n + 1), []);

  // Abort anything in flight when the learner, session or component goes away.
  React.useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  return {
    items,
    listState,
    loadingMore,
    loadMoreFailed,
    hasMore: cursor !== null,
    loadMore,
    retryList,
  };
}
