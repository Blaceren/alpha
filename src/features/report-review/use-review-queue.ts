"use client";

import * as React from "react";
import { fetchReviewQueue, type QueueOutcome } from "@/application/api/report-review-client";
import type { QueuePage } from "@/data/contracts/api/report-review";

/**
 * The queue fetch, and simultaneously the reviewer-capability probe.
 *
 * ## Why the queue itself is the probe
 *
 * The CRM staff session DTO carries `StaffProfile.staffRole` — the CRM
 * authorization axis. The Backend reviewer gate checks `User.role ∈ {mentor,
 * admin}` — a different axis that the staff DTO does not expose. So CRM cannot
 * tell a reviewer from ordinary staff locally, and must not try: inferring it
 * from the StaffProfile category would be exactly the unsafe client assumption
 * MR-1R forbids.
 *
 * Rather than widen the staff DTO (a contract change nobody reviewed) or add a
 * second probe endpoint, the queue read *is* the single explicit authenticated
 * capability probe. Its response is authoritative and already distinguishes every
 * case we need:
 *
 *   200 → reviewer; here is the queue
 *   403 (reviewer gate) → valid staff, not a reviewer  → bounded FORBIDDEN
 *   403 (flag envelope)  → REPORT disabled             → bounded FLAG_DISABLED
 *   401 → session gone                                 → the general auth boundary handles it
 *
 * One request answers both "may you review?" and "what is pending?", so the
 * boundary costs nothing extra.
 */
export type QueueState =
  | { kind: "loading" }
  | { kind: "ready"; page: QueuePage }
  | { kind: "empty" }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "flag_disabled" }
  | { kind: "error"; retryable: boolean };

function outcomeToState(outcome: QueueOutcome): QueueState {
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
      // contract violations for a plain queue read: fail closed, no retry offered.
      return { kind: "error", retryable: false };
  }
}

export interface UseReviewQueueOptions {
  /** Injection seam for tests; production uses the real client. */
  fetchQueueImpl?: typeof fetchReviewQueue;
  limit?: number;
}

export function useReviewQueue({ fetchQueueImpl = fetchReviewQueue, limit }: UseReviewQueueOptions = {}) {
  const [state, setState] = React.useState<QueueState>({ kind: "loading" });

  // Guards a refresh against running twice (double click, or a click while the
  // first request is still in flight).
  const inFlight = React.useRef(false);
  /**
   * Monotonic request id. Only the newest request may write state, so a slow
   * earlier response cannot overwrite a newer one — the STALE_RESULT case.
   */
  const generation = React.useRef(0);

  const load = React.useCallback(
    async (mode: "initial" | "refresh") => {
      if (inFlight.current) return;
      inFlight.current = true;
      generation.current += 1;
      const mine = generation.current;
      if (mode === "initial") setState({ kind: "loading" });

      try {
        const outcome = await fetchQueueImpl(limit === undefined ? {} : { limit });
        // Discard a stale response rather than rendering it.
        if (mine !== generation.current) return;
        setState(outcomeToState(outcome));
      } finally {
        inFlight.current = false;
      }
    },
    [fetchQueueImpl, limit],
  );

  React.useEffect(() => {
    void load("initial");
  }, [load]);

  const refresh = React.useCallback(() => void load("refresh"), [load]);

  return { state, refresh };
}
