"use client";

import * as React from "react";
import type { CrmApiUserNote } from "@/data/contracts/api/user-notes";
import type { NoteCreateOutcome, NotesListOutcome } from "@/application/api/user-notes-client";
import { isValidCrmUserId } from "@/data/contracts/api/user-id";
import { createApiCrmDataProvider, type CrmUsersReadCapability } from "@/data/api/api-crm-data-provider";

/**
 * Owns the production Notes read and the append for one learner.
 *
 * Nothing here is persisted: no localStorage, no sessionStorage, no draft
 * cache. A note list belongs to one learner under one employee session, and
 * both of those can change underneath us.
 */

export type NotesListState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "invalid_input" }
  | { kind: "unauthenticated" }
  | { kind: "forbidden"; requestId?: string }
  | { kind: "not_found" }
  | { kind: "upstream_unavailable" }
  | { kind: "malformed" };

export type NotesCreateState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "invalid_body"; reason: "blank" | "too_long" | "control_char" }
  | { kind: "invalid_input" }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "upstream_unavailable" }
  | { kind: "malformed" }
  | { kind: "created" };

/** How many notes one page requests. Within the backend's 1..100 bound. */
export const NOTES_PAGE_SIZE = 25;

export interface UseApiUserNotes {
  notes: CrmApiUserNote[];
  listState: NotesListState;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  hasMore: boolean;
  createState: NotesCreateState;
  loadMore: () => void;
  retryList: () => void;
  submit: (body: string) => void;
  resetCreateState: () => void;
}

export function useApiUserNotes(
  userId: string,
  canList: boolean,
  canCreate: boolean,
  provider?: CrmUsersReadCapability,
): UseApiUserNotes {
  const client = React.useMemo(() => provider ?? createApiCrmDataProvider(), [provider]);
  const validId = isValidCrmUserId(userId);

  const [notes, setNotes] = React.useState<CrmApiUserNote[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [listState, setListState] = React.useState<NotesListState>(
    canList && validId ? { kind: "loading" } : { kind: "idle" },
  );
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = React.useState(false);
  const [createState, setCreateState] = React.useState<NotesCreateState>({ kind: "idle" });
  const [nonce, setNonce] = React.useState(0);

  // One create at a time, and a sequence guard so a superseded page response
  // can never overwrite a newer one.
  const creating = React.useRef(false);
  const listSeq = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);
  const createAbortRef = React.useRef<AbortController | null>(null);

  /* ------------------------------------------------------------ first page */

  React.useEffect(() => {
    // No permission, or an id the backend could never accept: never request.
    if (!canList || !validId) {
      setNotes([]);
      setCursor(null);
      setListState({ kind: "idle" });
      return;
    }

    const seq = listSeq.current + 1;
    listSeq.current = seq;

    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;

    // Clear immediately: one learner's notes must never be visible for a
    // moment under another learner's heading.
    setNotes([]);
    setCursor(null);
    setLoadMoreFailed(false);
    setListState({ kind: "loading" });

    void client
      .listUserNotes(userId, { limit: NOTES_PAGE_SIZE }, { signal: controller.signal })
      .then((outcome: NotesListOutcome) => {
        if (cancelled || listSeq.current !== seq) return;
        if (outcome.status === "success") {
          setNotes(outcome.page.items);
          setCursor(outcome.page.nextCursor);
          setListState({ kind: "ready" });
          return;
        }
        setNotes([]);
        setCursor(null);
        switch (outcome.status) {
          case "invalid_input":
            setListState({ kind: "invalid_input" });
            break;
          case "unauthenticated":
            setListState({ kind: "unauthenticated" });
            break;
          case "forbidden":
            setListState({ kind: "forbidden", requestId: outcome.requestId });
            break;
          case "not_found":
            setListState({ kind: "not_found" });
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
  }, [client, userId, canList, validId, nonce]);

  /* ------------------------------------------------------------- load more */

  const loadMore = React.useCallback(() => {
    // A second click while a page is in flight must not start a second request.
    if (!canList || !validId || cursor === null || loadingMore) return;

    const seq = listSeq.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);

    void client
      .listUserNotes(userId, { limit: NOTES_PAGE_SIZE, cursor })
      .then((outcome: NotesListOutcome) => {
        if (listSeq.current !== seq) return;
        if (outcome.status === "success") {
          // Append only, preserving the server's order. Deduplication is
          // defensive: it drops a repeated noteId without reordering anything.
          setNotes((prev) => {
            const seen = new Set(prev.map((n) => n.noteId));
            return [...prev, ...outcome.page.items.filter((n) => !seen.has(n.noteId))];
          });
          setCursor(outcome.page.nextCursor);
        } else if (outcome.status === "unauthenticated") {
          setListState({ kind: "unauthenticated" });
        } else if (outcome.status === "not_found") {
          setListState({ kind: "not_found" });
        } else {
          // Keep every already-loaded row. A failed page is a failed page, not
          // a reason to discard what the employee is already reading.
          setLoadMoreFailed(true);
        }
      })
      .finally(() => {
        if (listSeq.current === seq) setLoadingMore(false);
      });
  }, [client, userId, canList, validId, cursor, loadingMore]);

  const retryList = React.useCallback(() => setNonce((n) => n + 1), []);

  /* ---------------------------------------------------------------- create */

  const submit = React.useCallback(
    (body: string) => {
      if (!canCreate || !validId || creating.current) return;

      creating.current = true;
      setCreateState({ kind: "pending" });

      const controller = new AbortController();
      createAbortRef.current = controller;

      void client
        .createUserNote(userId, body, { signal: controller.signal })
        .then((outcome: NoteCreateOutcome) => {
          if (outcome.status === "success") {
            // Insert only after a validated 201 — never optimistically. When the
            // employee cannot list notes, the row is not rendered at all; the
            // composer announces success instead.
            if (canList) {
              setNotes((prev) =>
                prev.some((n) => n.noteId === outcome.note.noteId)
                  ? prev
                  : [outcome.note, ...prev],
              );
            }
            setCreateState({ kind: "created" });
            return;
          }
          switch (outcome.status) {
            case "invalid_input":
              setCreateState({ kind: "invalid_input" });
              break;
            case "unauthenticated":
              setCreateState({ kind: "unauthenticated" });
              break;
            case "forbidden":
              setCreateState({ kind: "forbidden" });
              break;
            case "not_found":
              setCreateState({ kind: "not_found" });
              break;
            case "upstream_unavailable":
              setCreateState({ kind: "upstream_unavailable" });
              break;
            case "malformed_response":
              setCreateState({ kind: "malformed" });
              break;
          }
        })
        .finally(() => {
          creating.current = false;
        });
    },
    [client, userId, canCreate, canList, validId],
  );

  const resetCreateState = React.useCallback(() => setCreateState({ kind: "idle" }), []);

  // Abort anything in flight when the learner, session or component goes away.
  React.useEffect(
    () => () => {
      abortRef.current?.abort();
      createAbortRef.current?.abort();
    },
    [],
  );

  return {
    notes,
    listState,
    loadingMore,
    loadMoreFailed,
    hasMore: cursor !== null,
    createState,
    loadMore,
    retryList,
    submit,
    resetCreateState,
  };
}
