"use client";

/**
 * AFD-5C2 — the affiliate lead list workspace.
 *
 * THE URL IS THE SINGLE SOURCE OF TRUTH for every filter, the sort, the page
 * size and the cursor. This component holds no copy of that state: it parses
 * `useSearchParams()` on every render and writes changes back with
 * `router.push`. Back, forward, reload and a pasted link therefore all restore
 * the same screen by the same code path, and there is no second state to drift
 * out of sync with the address bar.
 *
 * THE ONE THING THAT IS NOT IN THE URL is the cursor TRAIL — a bounded map from
 * each visited cursor to the one that preceded it, which exists only so
 * "предыдущая страница" can return to a position the SERVER issued rather than
 * to one this component invented. It lives in a ref and is deliberately not
 * persisted: `localStorage` would resurrect a stale position in a later
 * session, and the URL already carries the only cursor that matters. The page
 * NUMBER is derived from it by walking back from the current cursor, so browser
 * back and forward stay consistent with what is on screen.
 *
 * NOTHING HERE CAN REVEAL AN IDENTITY. This module imports `fetchLeadList` and
 * `fetchAnalyticsFilters` and nothing else — `revealLeadPii` is not in scope, so
 * no code path in the list can call it, prefetch it or be tricked into it.
 */
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/states/empty-state";
import {
  fetchAnalyticsFilters,
  type AnalyticsOutcome,
} from "@/application/api/affiliate-analytics-client";
import type { AnalyticsFilterOptions } from "@/data/contracts/api/affiliate-analytics";
import {
  buildLeadQuery,
  fetchLeadList,
  type LeadListQuery,
  type LeadOutcome,
} from "@/application/api/affiliate-leads-client";
import type { LeadList } from "@/data/contracts/api/affiliate-leads";
import { useAffiliateAccess } from "@/features/affiliates/use-affiliate-access";
import { AffiliateSectionTabs } from "@/features/affiliates/affiliate-section-tabs";
import { LeadFilters } from "./lead-filters";
import { LeadPagination, LeadRows } from "./lead-list";
import {
  ErrorBlock,
  InfoNote,
  LoadingBlock,
  RefreshingBadge,
  SectionHeading,
} from "./lead-primitives";
import {
  CURSOR_RESET_NOTICE,
  describeLeadFailure,
  failureRequestId,
  FILTERS_LOADING,
  FORBIDDEN_MESSAGE,
  LEADS_DESCRIPTION,
  LEADS_TITLE,
  LIST_EMPTY_DESCRIPTION,
  LIST_EMPTY_TITLE,
  LIST_FILTERED_EMPTY_DESCRIPTION,
  LIST_FILTERED_EMPTY_TITLE,
  LIST_LOADING,
  RESET_FILTERS_LABEL,
  SUBPARAMETERS_NOTE,
} from "./leads-labels";
import {
  applyLeadsChange,
  DEFAULT_LEAD_STATE,
  isLeadsFiltered,
  leadListQueryFrom,
  parseLeadsUrlState,
  serializeLeadsUrlState,
  type LeadsUrlState,
} from "./leads-url-state";
import { useLeadResource } from "./use-lead-resource";

/**
 * How many visited cursors the trail remembers.
 *
 * Bounded so a very long paging session cannot grow the ref without limit. Past
 * the bound the oldest entries are dropped and "предыдущая" simply stops being
 * offered — which is honest: the component no longer holds a server-issued
 * position for that page and will not fabricate one.
 */
export const CURSOR_TRAIL_LIMIT = 50;

/**
 * The affiliate dictionary is fetched from the AFD-5C1 analytics filters route —
 * the established owner of the affiliate/campaign/link hierarchy, already
 * allow-listed by the CRM origin and already `view_affiliate_analytics`-gated.
 * Re-fetching the same three collections through the inventory API would be a
 * second source of truth for the same list.
 *
 * Its outcome union is the analytics one, so it is TRANSLATED EXHAUSTIVELY here
 * rather than cast. `bucket_cap_exceeded` cannot arise from a filters request —
 * it belongs to bucketed timeseries — but it is mapped rather than ignored, so
 * this stays a total function and a new analytics status would fail to compile
 * instead of falling through as a success.
 */
export function asLeadOutcome<T>(outcome: AnalyticsOutcome<T>): LeadOutcome<T> {
  switch (outcome.status) {
    case "success":
      return { status: "success", data: outcome.data };
    case "bucket_cap_exceeded":
    case "invalid_input":
      return {
        status: "invalid_input",
        messageKey: outcome.messageKey,
        ...(outcome.requestId === undefined ? {} : { requestId: outcome.requestId }),
      };
    case "not_found":
      return {
        status: "not_found",
        messageKey: outcome.messageKey,
        ...(outcome.requestId === undefined ? {} : { requestId: outcome.requestId }),
      };
    case "forbidden":
      return {
        status: "forbidden",
        messageKey: outcome.messageKey,
        ...(outcome.requestId === undefined ? {} : { requestId: outcome.requestId }),
      };
    case "misconfigured":
      return {
        status: "misconfigured",
        messageKey: outcome.messageKey,
        ...(outcome.requestId === undefined ? {} : { requestId: outcome.requestId }),
      };
    case "unauthenticated":
      return {
        status: "unauthenticated",
        ...(outcome.requestId === undefined ? {} : { requestId: outcome.requestId }),
      };
    case "rate_limited":
      return {
        status: "rate_limited",
        ...(outcome.requestId === undefined ? {} : { requestId: outcome.requestId }),
      };
    case "cancelled":
      return { status: "cancelled" };
    case "malformed_response":
      return { status: "malformed_response" };
    case "upstream_unavailable":
      return { status: "upstream_unavailable" };
  }
}

export function AffiliateLeadsWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { canRead } = useAffiliateAccess();

  const search = searchParams.toString();
  const state = React.useMemo(() => parseLeadsUrlState(search), [search]);

  /** Whether a refused cursor is still worth explaining. See the effect below. */
  const [cursorNotice, setCursorNotice] = React.useState(false);

  /* ------------------------------------------------------------- the trail */

  /**
   * Cursor → the cursor that preceded it. `null` marks the first page.
   *
   * A MAP KEYED BY CURSOR, NOT A STACK OF CLICKS. A stack records what the
   * operator PRESSED, and browser back does not press anything — so a stack
   * would still claim "страница 3" after the address bar had returned to page
   * one, and "предыдущая" would then jump somewhere neither the URL nor the
   * screen agreed with. Keying by cursor makes the depth a pure function of the
   * CURRENT URL, so back, forward, reload and a pasted link all agree.
   *
   * Never written to storage and never carried in the URL: it is a convenience
   * for going backwards, not part of the shareable state.
   */
  const trail = React.useRef<Map<string, string | null>>(new Map());

  /** How many pages deep the CURRENT cursor is, walked from the map. */
  const depthOf = React.useCallback((cursor: string | null): number => {
    let depth = 0;
    let current = cursor;
    // Bounded by the map's own size, so a corrupted chain cannot loop forever.
    while (current !== null && trail.current.has(current) && depth <= trail.current.size) {
      current = trail.current.get(current) ?? null;
      depth += 1;
    }
    return depth;
  }, []);

  const navigate = React.useCallback(
    (next: LeadsUrlState) => {
      const query = serializeLeadsUrlState(next);
      // A no-op change must not push a history entry: back would then appear
      // broken, returning the operator to an identical screen.
      if (query === serializeLeadsUrlState(state)) return;
      router.push(`${pathname}${query}`);
    },
    [pathname, router, state],
  );

  const change = React.useCallback(
    (partial: Partial<LeadsUrlState>) => {
      // Any change except paging resets the cursor (`applyLeadsChange`), so
      // every position in the trail belongs to a query that no longer exists.
      if (!(Object.keys(partial).length === 1 && "cursor" in partial)) {
        trail.current = new Map();
        setCursorNotice(false);
      }
      navigate(applyLeadsChange(state, partial));
    },
    [navigate, state],
  );

  const reset = React.useCallback(() => {
    trail.current = new Map();
    setCursorNotice(false);
    navigate({ ...DEFAULT_LEAD_STATE });
  }, [navigate]);

  /* ----------------------------------------------------------- the requests */

  const listQuery: LeadListQuery = React.useMemo(
    () => leadListQueryFrom(state) as LeadListQuery,
    [state],
  );

  // The serialized query IS the request identity. One URL transition therefore
  // issues exactly one list request, and a re-render that changes nothing issues
  // none.
  const listKey = React.useMemo(() => buildLeadQuery(listQuery), [listQuery]);

  const list = useLeadResource<LeadList>(listKey, canRead, (signal) =>
    fetchLeadList(listQuery, { signal }),
  );

  /**
   * The filter dictionary, requested UNSCOPED and exactly once.
   *
   * WHY NO PARENT IS SENT. The filters route narrows the PARTNER list itself to
   * the partner it is given (`partnerWhere = { id }`), so a scoped request
   * returns a dropdown containing only the affiliate already chosen — and an
   * operator who picked Alpha could never switch to Beta without first clearing
   * the filter. The hierarchy is applied CLIENT-SIDE instead, in
   * `DimensionFilters`, which already scopes campaigns to the chosen affiliate
   * and links to the chosen campaign from the full dictionary.
   *
   * A constant key also means one request per session rather than one per
   * parent change.
   */
  const filters = useLeadResource<AnalyticsFilterOptions>("lead-filters", canRead, (signal) =>
    fetchAnalyticsFilters({}, { signal }).then(asLeadOutcome),
  );

  /**
   * A cursor the backend refused.
   *
   * A tampered, truncated or filter-mismatched cursor is RECOVERED FROM rather
   * than reported as a dead end: the URL is rewritten to the same query without
   * a cursor, so the operator lands on page one of the list they asked for.
   * `router.replace` — not `push` — because a broken position is not a place
   * the back button should return to.
   *
   * THE EXPLANATION OUTLIVES THE REPAIR. The rejection itself disappears the
   * moment the repaired request succeeds, so a notice rendered from the failure
   * would flash and vanish and the operator would silently be on a different
   * page than the link they followed. The notice is therefore its own state,
   * set here and cleared only when the operator does something else.
   */
  const cursorRejected = list.failure?.status === "cursor_invalid";
  React.useEffect(() => {
    if (!cursorRejected || state.cursor === null) return;
    trail.current = new Map();
    setCursorNotice(true);
    router.replace(`${pathname}${serializeLeadsUrlState({ ...state, cursor: null })}`);
  }, [cursorRejected, pathname, router, state]);

  /* --------------------------------------------------------------- paging */

  const goNext = React.useCallback(() => {
    const next = list.data?.nextCursor;
    if (!next) return;
    // Record where this position came from, so "предыдущая" returns to a cursor
    // the SERVER issued rather than to one this component invented.
    if (trail.current.size >= CURSOR_TRAIL_LIMIT) {
      // Bounded. Past the limit the oldest link is dropped and "предыдущая"
      // simply stops being offered for that page — honest, because the
      // component no longer holds a server-issued position for it.
      const oldest = trail.current.keys().next();
      if (!oldest.done) trail.current.delete(oldest.value);
    }
    trail.current.set(next, state.cursor);
    setCursorNotice(false);
    navigate({ ...state, cursor: next });
  }, [list.data, navigate, state]);

  const goPrevious = React.useCallback(() => {
    if (state.cursor === null) return;
    const previous = trail.current.get(state.cursor);
    if (previous === undefined) return;
    setCursorNotice(false);
    navigate({ ...state, cursor: previous });
  }, [navigate, state]);

  const goFirst = React.useCallback(() => {
    setCursorNotice(false);
    navigate({ ...state, cursor: null });
  }, [navigate, state]);

  /* ---------------------------------------------------------------- render */

  if (!canRead) {
    return (
      <div className="space-y-4">
        <PageHeader title={LEADS_TITLE} />
        <EmptyState title="Раздел недоступен" description={FORBIDDEN_MESSAGE} />
      </div>
    );
  }

  const filtered = isLeadsFiltered(state);
  const rows = list.data?.rows ?? [];
  // Derived from the CURRENT cursor, so browser back and forward stay honest.
  const page = depthOf(state.cursor) + 1;
  const canGoBack = state.cursor !== null && trail.current.has(state.cursor);

  return (
    <div className="space-y-4">
      <PageHeader title={LEADS_TITLE} description={LEADS_DESCRIPTION} />
      <AffiliateSectionTabs active="leads" />

      <LeadFilters
        options={filters.data}
        state={state}
        registrationResolved={list.data?.periods.registration ?? null}
        acquisitionResolved={list.data?.periods.acquisition ?? null}
        onChange={change}
        onReset={reset}
        filtered={filtered}
        disabled={false}
      />

      {filters.failure ? (
        <ErrorBlock
          message={describeLeadFailure(filters.failure)}
          requestId={failureRequestId(filters.failure)}
          onRetry={filters.reload}
        />
      ) : null}
      {filters.loading ? <LoadingBlock label={FILTERS_LOADING} /> : null}

      <section aria-labelledby="leads-list-heading" className="space-y-3">
        <SectionHeading
          id="leads-list-heading"
          title="Лиды"
          description={SUBPARAMETERS_NOTE}
          actions={list.refreshing ? <RefreshingBadge /> : null}
        />

        {cursorNotice ? <InfoNote tone="warning">{CURSOR_RESET_NOTICE}</InfoNote> : null}

        {list.loading ? <LoadingBlock label={LIST_LOADING} /> : null}

        {/* A cursor rejection is already being repaired by the effect above, so
            it is shown as the recoverable notice and never as a hard error. */}
        {list.failure && !cursorRejected ? (
          <ErrorBlock
            message={describeLeadFailure(list.failure)}
            requestId={failureRequestId(list.failure)}
            onRetry={list.reload}
          />
        ) : null}

        {list.data && rows.length === 0 ? (
          filtered ? (
            <EmptyState
              title={LIST_FILTERED_EMPTY_TITLE}
              description={LIST_FILTERED_EMPTY_DESCRIPTION}
              action={
                <button
                  type="button"
                  onClick={reset}
                  className="min-h-[2.25rem] rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {RESET_FILTERS_LABEL}
                </button>
              }
            />
          ) : (
            <EmptyState title={LIST_EMPTY_TITLE} description={LIST_EMPTY_DESCRIPTION} />
          )
        ) : null}

        {rows.length > 0 ? (
          <>
            <LeadRows rows={rows} />
            <LeadPagination
              page={page}
              rowCount={rows.length}
              hasMore={list.data?.hasMore ?? false}
              canGoBack={canGoBack}
              onNext={goNext}
              onPrevious={goPrevious}
              onFirst={goFirst}
              busy={list.loading || list.refreshing}
            />
          </>
        ) : null}
      </section>
    </div>
  );
}
