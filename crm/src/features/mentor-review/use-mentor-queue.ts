"use client";

import * as React from "react";
import { fetchMentorQueue, type MentorQueueOutcome } from "@/application/api/mentor-review-client";
import type { MentorQueuePage } from "@/data/contracts/api/mentor-review";

/**
 * G3 — the mentor queue fetch, and simultaneously the reviewer-capability probe.
 *
 * Deliberately the same shape as `use-review-queue.ts`, for the same reason it
 * gives: the CRM staff session DTO carries `StaffProfile.staffRole`, while the
 * Backend reviewer gate checks `User.role ∈ {mentor, admin}`. Those are
 * different axes and CRM cannot infer one from the other, so the queue read IS
 * the authenticated capability probe:
 *
 *   200 → reviewer; here is the queue
 *   403 (reviewer gate) → valid staff, not a reviewer → bounded FORBIDDEN
 *   403 (flag envelope) → curriculum flags off        → bounded FLAG_DISABLED
 *   401 → session gone                                → the auth boundary handles it
 */
export type MentorQueueState =
  | { kind: "loading" }
  | { kind: "ready"; page: MentorQueuePage }
  | { kind: "empty" }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "flag_disabled" }
  | { kind: "error"; retryable: boolean };

function outcomeToState(outcome: MentorQueueOutcome): MentorQueueState {
  switch (outcome.status) {
    case "success":
      return outcome.page.items.length === 0 ? { kind: "empty" } : { kind: "ready", page: outcome.page };
    case "unauthenticated":
      return { kind: "unauthorized" };
    case "forbidden":
      return { kind: "forbidden" };
    case "flag_disabled":
      return { kind: "flag_disabled" };
    case "upstream_unavailable":
    case "rate_limited":
      return { kind: "error", retryable: true };
    default:
      // invalid_input, not_found, conflict and malformed_response are all
      // contract violations for a plain queue read: fail closed, no retry.
      return { kind: "error", retryable: false };
  }
}

export interface UseMentorQueueOptions {
  /** Injection seam for tests; production uses the real client. */
  fetchQueueImpl?: typeof fetchMentorQueue;
  limit?: number;
}

export function useMentorQueue({ fetchQueueImpl = fetchMentorQueue, limit }: UseMentorQueueOptions = {}) {
  const [state, setState] = React.useState<MentorQueueState>({ kind: "loading" });
  const inFlight = React.useRef(false);

  const load = React.useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ kind: "loading" });
    try {
      const outcome = await fetchQueueImpl(limit === undefined ? {} : { limit });
      setState(outcomeToState(outcome));
    } finally {
      inFlight.current = false;
    }
  }, [fetchQueueImpl, limit]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return { state, refresh: load } as const;
}
