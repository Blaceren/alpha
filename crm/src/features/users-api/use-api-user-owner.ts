"use client";

import * as React from "react";
import type { CrmApiOwnerCandidate, CrmApiOwnerIdentity } from "@/data/contracts/api/user-owner";
import type {
  OwnerCandidatesOutcome,
  OwnerMutationOutcome,
  OwnerReadOutcome,
} from "@/application/api/user-owner-client";
import { isValidCrmUserId } from "@/data/contracts/api/user-id";
import { createApiCrmDataProvider, type CrmUsersReadCapability } from "@/data/api/api-crm-data-provider";

/**
 * Owns the production current-owner read, the eligible-candidate directory and
 * the assign/replace/unassign mutation for one learner.
 *
 * Nothing here is persisted: no localStorage, no sessionStorage, no draft cache.
 * Owner state belongs to one learner under one employee session, and both of
 * those can change underneath us — every request is aborted on either change.
 *
 * There is NO optimistic update. `ownerVersion` is never derived locally; it is
 * only ever the exact value a validated server response carried.
 */

export type OwnerReadState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "invalid_input" }
  | { kind: "unauthenticated" }
  | { kind: "forbidden"; requestId?: string }
  | { kind: "not_found" }
  | { kind: "upstream_unavailable" }
  | { kind: "malformed" };

export type CandidatesState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded" }
  | { kind: "forbidden" }
  | { kind: "unavailable" };

export type MutationState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "success" }
  | { kind: "conflict" }
  | { kind: "conflict_refetch_failed" }
  | { kind: "candidate_unavailable" }
  | { kind: "forbidden" }
  | { kind: "invalid_input" }
  | { kind: "failed" };

/** One page requests the backend maximum; a small directory is expected. */
export const CANDIDATES_PAGE_SIZE = 100;
/** Hard ceiling: v1 renders a native select, so more than this is unavailable. */
export const CANDIDATES_MAX_TOTAL = 100;
/** Safety bound on sequential page walks, independent of the total ceiling. */
export const CANDIDATES_MAX_PAGES = 5;

export interface UseApiUserOwner {
  readState: OwnerReadState;
  owner: CrmApiOwnerIdentity | null;
  ownerVersion: number;
  candidatesState: CandidatesState;
  candidates: CrmApiOwnerCandidate[];
  mutationState: MutationState;
  retryOwner: () => void;
  loadCandidates: () => void;
  assign: (ownerEmployeeId: string | null) => void;
  resetMutation: () => void;
  /** Set once the backend forbids the mutation, so controls stay withdrawn. */
  assignForbidden: boolean;
}

export function useApiUserOwner(
  userId: string,
  canAssign: boolean,
  provider: CrmUsersReadCapability | undefined,
  callbacks: {
    onUnauthenticated: () => void;
    onLearnerNotFound: () => void;
    onForbidden: () => void;
  },
  /** Changes when the employee session changes, forcing a clean refetch. */
  sessionKey?: string,
): UseApiUserOwner {
  const client = React.useMemo(() => provider ?? createApiCrmDataProvider(), [provider]);
  const validId = isValidCrmUserId(userId);

  const [readState, setReadState] = React.useState<OwnerReadState>(
    validId ? { kind: "loading" } : { kind: "invalid_input" },
  );
  const [owner, setOwner] = React.useState<CrmApiOwnerIdentity | null>(null);
  const [ownerVersion, setOwnerVersion] = React.useState(0);
  const [candidatesState, setCandidatesState] = React.useState<CandidatesState>({ kind: "idle" });
  const [candidates, setCandidates] = React.useState<CrmApiOwnerCandidate[]>([]);
  const [mutationState, setMutationState] = React.useState<MutationState>({ kind: "idle" });
  const [assignForbidden, setAssignForbidden] = React.useState(false);
  const [nonce, setNonce] = React.useState(0);

  // Sequence guard so a superseded owner response can never overwrite a newer
  // one; single-flight guards for candidates and the mutation.
  const readSeq = React.useRef(0);
  const readAbort = React.useRef<AbortController | null>(null);
  const candidatesAbort = React.useRef<AbortController | null>(null);
  const mutationAbort = React.useRef<AbortController | null>(null);
  const loadingCandidates = React.useRef(false);
  const mutating = React.useRef(false);

  const { onUnauthenticated, onLearnerNotFound, onForbidden } = callbacks;

  // Keep the latest callbacks in refs so the read effect does not re-run (and
  // re-request) merely because a parent re-created a handler.
  const cbRef = React.useRef(callbacks);
  React.useEffect(() => {
    cbRef.current = { onUnauthenticated, onLearnerNotFound, onForbidden };
  }, [onUnauthenticated, onLearnerNotFound, onForbidden]);

  /* --------------------------------------------------------- current owner */

  const applyReadOutcome = React.useCallback((outcome: OwnerReadOutcome) => {
    if (outcome.status === "success") {
      setOwner(outcome.owner.owner);
      setOwnerVersion(outcome.owner.ownerVersion);
      setReadState({ kind: "ready" });
      return;
    }
    setOwner(null);
    setOwnerVersion(0);
    switch (outcome.status) {
      case "invalid_input":
        setReadState({ kind: "invalid_input" });
        break;
      case "unauthenticated":
        setReadState({ kind: "unauthenticated" });
        cbRef.current.onUnauthenticated();
        break;
      case "forbidden":
        setReadState({ kind: "forbidden", requestId: outcome.requestId });
        cbRef.current.onForbidden();
        break;
      case "not_found":
        setReadState({ kind: "not_found" });
        cbRef.current.onLearnerNotFound();
        break;
      case "upstream_unavailable":
        setReadState({ kind: "upstream_unavailable" });
        break;
      case "malformed_response":
        setReadState({ kind: "malformed" });
        break;
    }
  }, []);

  React.useEffect(() => {
    if (!validId) {
      setReadState({ kind: "invalid_input" });
      setOwner(null);
      setOwnerVersion(0);
      return;
    }

    const seq = readSeq.current + 1;
    readSeq.current = seq;
    const controller = new AbortController();
    readAbort.current = controller;
    let cancelled = false;

    // Clear immediately so one learner's owner is never visible under another's
    // heading, and reset the editing surface for the new learner/session.
    setOwner(null);
    setOwnerVersion(0);
    setReadState({ kind: "loading" });
    setCandidatesState({ kind: "idle" });
    setCandidates([]);
    setMutationState({ kind: "idle" });
    setAssignForbidden(false);

    void client.getUserOwner(userId, { signal: controller.signal }).then((outcome) => {
      if (cancelled || readSeq.current !== seq) return;
      applyReadOutcome(outcome);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // sessionKey is intentionally a dependency: a session change forces a clean
    // refetch under the new identity.
  }, [client, userId, validId, nonce, sessionKey, applyReadOutcome]);

  const retryOwner = React.useCallback(() => setNonce((n) => n + 1), []);

  /* ------------------------------------------------------ owner candidates */

  const loadCandidates = React.useCallback(() => {
    if (!canAssign || !validId || loadingCandidates.current) return;
    loadingCandidates.current = true;

    const controller = new AbortController();
    candidatesAbort.current = controller;
    setCandidatesState({ kind: "loading" });

    void (async () => {
      const collected: CrmApiOwnerCandidate[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      let pages = 0;

      // Walk bounded pages sequentially, preserving backend order and
      // deduplicating by employeeId. Never silently truncate: exceeding the
      // ceiling with more still to come is a visible unavailable state.
      for (;;) {
        const outcome: OwnerCandidatesOutcome = await client.listOwnerCandidates(
          { limit: CANDIDATES_PAGE_SIZE, ...(cursor ? { cursor } : {}) },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;

        if (outcome.status !== "success") {
          if (outcome.status === "unauthenticated") {
            setCandidatesState({ kind: "unavailable" });
            cbRef.current.onUnauthenticated();
          } else if (outcome.status === "forbidden") {
            setCandidatesState({ kind: "forbidden" });
            setAssignForbidden(true);
          } else {
            // invalid_input, not_found, upstream_unavailable, malformed.
            setCandidatesState({ kind: "unavailable" });
          }
          return;
        }

        for (const item of outcome.page.items) {
          if (!seen.has(item.employeeId)) {
            seen.add(item.employeeId);
            collected.push(item);
          }
        }
        pages += 1;
        cursor = outcome.page.nextCursor ?? undefined;

        if (!cursor) break;
        if (collected.length >= CANDIDATES_MAX_TOTAL || pages >= CANDIDATES_MAX_PAGES) {
          // More candidates than v1's native select is designed to hold. Fail
          // to a safe unavailable state rather than truncate silently.
          setCandidates([]);
          setCandidatesState({ kind: "unavailable" });
          return;
        }
      }

      setCandidates(collected);
      setCandidatesState({ kind: "loaded" });
    })().finally(() => {
      loadingCandidates.current = false;
    });
  }, [client, canAssign, validId]);

  /* -------------------------------------------------------------- mutation */

  const refetchOwnerAfterConflict = React.useCallback(
    async (signal: AbortSignal) => {
      const outcome = await client.getUserOwner(userId, { signal });
      if (signal.aborted) return false;
      if (outcome.status === "success") {
        setOwner(outcome.owner.owner);
        setOwnerVersion(outcome.owner.ownerVersion);
        setReadState({ kind: "ready" });
        return true;
      }
      // A learner/session answer during the refetch escalates as usual.
      if (outcome.status === "unauthenticated") cbRef.current.onUnauthenticated();
      if (outcome.status === "not_found") cbRef.current.onLearnerNotFound();
      if (outcome.status === "forbidden") cbRef.current.onForbidden();
      return false;
    },
    [client, userId],
  );

  const assign = React.useCallback(
    (ownerEmployeeId: string | null) => {
      if (!canAssign || !validId || mutating.current) return;
      mutating.current = true;
      setMutationState({ kind: "pending" });

      const controller = new AbortController();
      mutationAbort.current = controller;

      void client
        .setUserOwner(userId, ownerEmployeeId, ownerVersion, { signal: controller.signal })
        .then(async (outcome: OwnerMutationOutcome) => {
          if (controller.signal.aborted) return;

          if (outcome.status === "success") {
            setOwner(outcome.owner.owner);
            setOwnerVersion(outcome.owner.ownerVersion);
            setReadState({ kind: "ready" });
            setMutationState({ kind: "success" });
            return;
          }

          if (outcome.status === "conflict") {
            // Do NOT apply the attempted owner. Refetch the current owner and
            // let the employee make a fresh explicit choice. Never auto-retry.
            const ok = await refetchOwnerAfterConflict(controller.signal);
            if (controller.signal.aborted) return;
            setMutationState({ kind: ok ? "conflict" : "conflict_refetch_failed" });
            return;
          }

          switch (outcome.status) {
            case "candidate_not_found":
              // The learner is fine; the chosen employee is unavailable. Keep the
              // current owner and reload the candidate directory.
              setMutationState({ kind: "candidate_unavailable" });
              loadCandidates();
              break;
            case "not_found":
              cbRef.current.onLearnerNotFound();
              break;
            case "unauthenticated":
              cbRef.current.onUnauthenticated();
              break;
            case "forbidden":
              setAssignForbidden(true);
              setMutationState({ kind: "forbidden" });
              break;
            case "invalid_input":
              setMutationState({ kind: "invalid_input" });
              break;
            case "upstream_unavailable":
            case "malformed_response":
              setMutationState({ kind: "failed" });
              break;
          }
        })
        .finally(() => {
          mutating.current = false;
        });
    },
    [client, userId, canAssign, validId, ownerVersion, refetchOwnerAfterConflict, loadCandidates],
  );

  const resetMutation = React.useCallback(() => setMutationState({ kind: "idle" }), []);

  // Abort everything in flight when the learner, session or component goes away.
  React.useEffect(
    () => () => {
      readAbort.current?.abort();
      candidatesAbort.current?.abort();
      mutationAbort.current?.abort();
    },
    [],
  );

  return {
    readState,
    owner,
    ownerVersion,
    candidatesState,
    candidates,
    mutationState,
    retryOwner,
    loadCandidates,
    assign,
    resetMutation,
    assignForbidden,
  };
}
