"use client";

/**
 * AFD-5C1 — one independently-loading analytics section.
 *
 * THE PROBLEM THIS EXISTS TO SOLVE. The summary, the chart and the breakdown are
 * three requests that answer the same filter state at different speeds. An
 * operator who switches from "Аффилейт Alpha" to "Аффилейт Beta" while the first
 * request is still in flight must never see Alpha's numbers under Beta's
 * heading. That is not a cosmetic race: it is a report that is wrong and looks
 * right.
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
 * PREVIOUS DATA STAYS ON SCREEN while a refresh runs, marked `refreshing`, so a
 * filter change does not blank the page (§34). The moment the new data arrives
 * it replaces the old wholesale — there is no merge, so a section never shows
 * half of one period and half of another.
 *
 * DE-DUPLICATION. The effect is keyed on the SERIALIZED query, so one URL
 * transition issues exactly one request per section, and a re-render that does
 * not change the query issues none.
 */
import * as React from "react";
import type { AnalyticsOutcome } from "@/application/api/affiliate-analytics-client";

export interface SectionState<T> {
  /** The most recent successfully loaded payload, or null before the first. */
  data: T | null;
  /** True only before the first successful load. */
  loading: boolean;
  /** True while a background reload runs with `data` still on screen. */
  refreshing: boolean;
  failure: AnalyticsOutcome<T> | null;
  reload: () => void;
}

/**
 * @param key      The serialized request identity. A change re-fetches; an
 *                 identical value does not.
 * @param enabled  False parks the section without issuing a request — used to
 *                 keep the inactive mode's endpoints entirely unrequested.
 * @param run      Issues the request. Receives the abort signal to forward.
 */
export function useAnalyticsSection<T>(
  key: string,
  enabled: boolean,
  run: (signal: AbortSignal) => Promise<AnalyticsOutcome<T>>,
): SectionState<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(enabled);
  const [refreshing, setRefreshing] = React.useState(false);
  const [failure, setFailure] = React.useState<AnalyticsOutcome<T> | null>(null);
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
      // Park: abort anything in flight and stop claiming to be loading.
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

  // Abort whatever is in flight when the section unmounts.
  React.useEffect(() => () => controller.current?.abort(), []);

  const reload = React.useCallback(() => setReloadToken((token) => token + 1), []);

  return { data, loading, refreshing, failure, reload };
}
