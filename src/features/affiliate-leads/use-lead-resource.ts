"use client";

/**
 * AFD-5C2 — one independently-loading lead resource.
 *
 * THE PROBLEM THIS EXISTS TO SOLVE. An operator who switches from "Аффилейт
 * Alpha" to "Аффилейт Beta", or from lead A to lead B, while the first request
 * is still in flight must never see Alpha's rows under Beta's heading or A's
 * timeline under B's masked address. On a lead screen that is not a cosmetic
 * race: it is one learner's commercial history displayed as another's.
 *
 * TWO INDEPENDENT DEFENCES, because either alone is insufficient:
 *
 *   1. ABORT. Every new request aborts the previous one through an
 *      `AbortController`, so an obsolete response is usually never received at
 *      all and the connection is released.
 *
 *   2. GENERATION CHECK. Abort is asynchronous — a response already parsed in
 *      the microtask queue still arrives. Each request carries a monotonically
 *      increasing generation, and a result whose generation is not the current
 *      one is DISCARDED rather than rendered. This is what actually guarantees
 *      that a late response cannot overwrite a newer state.
 *
 * DE-DUPLICATION. The effect is keyed on the SERIALIZED request identity, so one
 * URL transition issues exactly one request, and a re-render that does not change
 * the key issues none. That is what keeps a filter change from becoming a
 * request storm.
 *
 * THE PREVIOUS PAGE STAYS ON SCREEN while a refresh runs, marked `refreshing`,
 * so a filter change does not blank the table. It is replaced wholesale the
 * moment the new data arrives — there is no merge, so the list never shows half
 * of one filter's rows and half of another's.
 *
 * THIS HOOK IS NEVER USED FOR THE PII REVEAL. It is an effect that fires on key
 * change, which is precisely the shape a reveal must not have: mounting a route,
 * changing a filter or restoring a history entry would each mint an audit row
 * for a disclosure nobody asked for. The reveal is called from an explicit
 * handler and lives in `lead-reveal.tsx`.
 */
import * as React from "react";
import type { LeadOutcome } from "@/application/api/affiliate-leads-client";

export interface LeadResourceState<T> {
  /** The most recent successfully loaded payload, or null before the first. */
  data: T | null;
  /** True only before the first successful load. */
  loading: boolean;
  /** True while a background reload runs with `data` still on screen. */
  refreshing: boolean;
  failure: LeadOutcome<T> | null;
  reload: () => void;
}

/**
 * @param key      The serialized request identity. A change re-fetches; an
 *                 identical value does not.
 * @param enabled  False parks the resource without issuing a request.
 * @param run      Issues the request. Receives the abort signal to forward.
 */
export function useLeadResource<T>(
  key: string,
  enabled: boolean,
  run: (signal: AbortSignal) => Promise<LeadOutcome<T>>,
): LeadResourceState<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(enabled);
  const [refreshing, setRefreshing] = React.useState(false);
  const [failure, setFailure] = React.useState<LeadOutcome<T> | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);

  const generation = React.useRef(0);
  const controller = React.useRef<AbortController | null>(null);
  // Read inside the effect but deliberately NOT a dependency: `run` is a new
  // closure on every render, and depending on it would re-fetch continuously.
  // The `key` is the request identity, and it is the dependency.
  const runRef = React.useRef(run);
  runRef.current = run;

  const hasData = data !== null;

  React.useEffect(() => {
    if (!enabled) {
      controller.current?.abort();
      controller.current = null;
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const current = ++generation.current;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;

    if (hasData) setRefreshing(true);
    else setLoading(true);

    void runRef.current(next.signal).then((outcome) => {
      // The generation check. A response from a superseded request is dropped
      // here, whether or not the abort reached it in time.
      if (current !== generation.current) return;

      setLoading(false);
      setRefreshing(false);

      if (outcome.status === "success") {
        setData(outcome.data);
        setFailure(null);
        return;
      }
      // A cancelled request is not a failure and must not replace the screen
      // with an error the operator did not cause.
      if (outcome.status === "cancelled") return;
      setFailure(outcome);
    });

    return () => {
      next.abort();
    };
    // `hasData` is intentionally absent: including it would re-run the effect
    // when the first response lands and issue a second identical request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, reloadToken]);

  // Abort whatever is in flight when the resource unmounts.
  React.useEffect(() => () => controller.current?.abort(), []);

  const reload = React.useCallback(() => setReloadToken((token) => token + 1), []);

  return { data, loading, refreshing, failure, reload };
}
