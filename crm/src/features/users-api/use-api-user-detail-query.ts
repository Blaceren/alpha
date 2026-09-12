"use client";

import * as React from "react";
import type { CrmApiUserDetail } from "@/data/contracts/api/user-detail";
import type { UserDetailOutcome } from "@/application/api/user-detail-client";
import { isValidCrmUserId } from "@/data/contracts/api/user-id";
import { createApiCrmDataProvider, type CrmUsersReadCapability } from "@/data/api/api-crm-data-provider";

export type ApiUserDetailViewState =
  | { kind: "loading" }
  | { kind: "retrying" }
  | { kind: "ready"; detail: CrmApiUserDetail }
  | { kind: "invalid_id" }
  | { kind: "invalid_input"; requestId?: string }
  | { kind: "unauthenticated" }
  | { kind: "forbidden"; requestId?: string }
  | { kind: "not_found"; requestId?: string }
  | { kind: "upstream_unavailable" }
  | { kind: "malformed" };

function outcomeToState(outcome: UserDetailOutcome): ApiUserDetailViewState {
  switch (outcome.status) {
    case "success":
      return { kind: "ready", detail: outcome.detail };
    case "invalid_input":
      return { kind: "invalid_input", requestId: outcome.requestId };
    case "unauthenticated":
      return { kind: "unauthenticated" };
    case "forbidden":
      return { kind: "forbidden", requestId: outcome.requestId };
    case "not_found":
      return { kind: "not_found", requestId: outcome.requestId };
    case "upstream_unavailable":
      return { kind: "upstream_unavailable" };
    case "malformed_response":
      return { kind: "malformed" };
  }
}

export interface UseApiUserDetailQuery {
  state: ApiUserDetailViewState;
  retry: () => void;
}

/**
 * Owns the production learner-detail read for one `userId`.
 *
 * A malformed id short-circuits to a local state and never reaches the network:
 * the backend would answer 400 anyway, and spending a request to be told so
 * would only add a spinner before the same answer.
 */
export function useApiUserDetailQuery(
  userId: string,
  provider?: CrmUsersReadCapability,
): UseApiUserDetailQuery {
  const client = React.useMemo(() => provider ?? createApiCrmDataProvider(), [provider]);

  const validId = isValidCrmUserId(userId);

  const [state, setState] = React.useState<ApiUserDetailViewState>(
    validId ? { kind: "loading" } : { kind: "invalid_id" },
  );
  const [nonce, setNonce] = React.useState(0);

  // Guards a retry against being started twice, and lets the effect drop a
  // superseded response instead of letting it overwrite a newer one.
  const inFlight = React.useRef(false);
  const requestSeq = React.useRef(0);

  React.useEffect(() => {
    if (!validId) {
      setState({ kind: "invalid_id" });
      return;
    }

    const seq = requestSeq.current + 1;
    requestSeq.current = seq;

    const controller = new AbortController();
    let cancelled = false;

    setState((prev) => (prev.kind === "ready" ? { kind: "retrying" } : { kind: "loading" }));
    inFlight.current = true;

    void client
      .getUserDetail(userId, { signal: controller.signal })
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
  }, [client, userId, validId, nonce]);

  const retry = React.useCallback(() => {
    if (inFlight.current || !validId) return;
    setNonce((n) => n + 1);
  }, [validId]);

  return { state, retry };
}
