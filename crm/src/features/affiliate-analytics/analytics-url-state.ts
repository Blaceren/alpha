/**
 * AFD-5C1 — the shareable analytics state, and its exact URL grammar.
 *
 * WHY THE URL IS THE STATE. An analyst who has found something needs to send it
 * to somebody. Every control on the page therefore round-trips through the query
 * string, and the component tree reads its state FROM the parsed URL rather than
 * keeping a second copy — so back, forward, reload and a pasted link cannot
 * disagree with what is on screen.
 *
 * WHAT MAY NEVER APPEAR HERE. Only mode, period, cutoff, grouping, three numeric
 * dimension ids, the breakdown dimension, the coverage view and a page offset.
 * There is no key for an API token, a session value, a learner email, a Pocket
 * id, an external click id, an ataClickId or a visitor id — the parser below is
 * a closed list, so an unknown key is DROPPED rather than carried, and a URL
 * cannot be used to smuggle one of those into a link somebody shares.
 *
 * NORMALISATION IS TOTAL, AND IT NEVER THROWS. A hand-edited or truncated URL
 * must still open a usable page: every field falls back to its default when it
 * does not match the grammar. The BACKEND remains authoritative — a syntactically
 * valid affiliate id that does not exist is refused there, with its own 404,
 * and this parser deliberately does not pretend to know.
 */
import type {
  BreakdownDimension,
  BucketGroup,
  DatePreset,
} from "@/data/contracts/api/affiliate-analytics";

export type AnalyticsMode = "event_date" | "acquisition_cohort";

/** Which slice of event-date coverage the summary and chart display. */
export type CoverageView = "total" | "attributed" | "unattributed";

export interface AnalyticsUrlState {
  mode: AnalyticsMode;
  preset: DatePreset;
  /** `YYYY-MM-DD`, present only when `preset === "custom"`. */
  startDate: string | null;
  endDate: string | null;
  /** Cohort-only observation cutoff. Null means "the report clock". */
  cutoffDate: string | null;
  group: BucketGroup;
  affiliatePartnerId: string | null;
  affiliateCampaignId: string | null;
  affiliateTrackingLinkId: string | null;
  dimension: BreakdownDimension;
  coverage: CoverageView;
  offset: number;
}

/**
 * Event-date, last 30 days, by day, unfiltered.
 *
 * `event_date` is the default mode because it is the only one that reports
 * DIRECT traffic as well as attributed — an operator who lands here with no
 * opinion should see everything that happened, not the attributed subset.
 */
export const DEFAULT_ANALYTICS_STATE: AnalyticsUrlState = {
  mode: "event_date",
  preset: "last_30_days",
  startDate: null,
  endDate: null,
  cutoffDate: null,
  group: "day",
  affiliatePartnerId: null,
  affiliateCampaignId: null,
  affiliateTrackingLinkId: null,
  dimension: "affiliate",
  coverage: "total",
  offset: 0,
};

const MODES: readonly AnalyticsMode[] = ["event_date", "acquisition_cohort"];
const PRESETS: readonly DatePreset[] = [
  "today",
  "yesterday",
  "current_week",
  "previous_week",
  "last_7_days",
  "last_30_days",
  "current_month",
  "previous_month",
  "custom",
  "all_time",
];
const GROUPS: readonly BucketGroup[] = ["day", "week", "month"];
const DIMENSIONS: readonly BreakdownDimension[] = ["affiliate", "campaign", "tracking_link"];
const COVERAGES: readonly CoverageView[] = ["total", "attributed", "unattributed"];

/**
 * A calendar date, validated as a real one.
 *
 * The regex alone would accept `2026-02-31`; the round-trip through `Date.UTC`
 * rejects it. An impossible date must never reach the backend as if it were a
 * period boundary — see §19.
 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateOnly(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** A positive decimal id, as the backend's own filter grammar spells it. */
const ID_PATTERN = /^\d{1,9}$/;

function readId(params: URLSearchParams, key: string): string | null {
  const raw = params.get(key);
  if (raw === null) return null;
  if (!ID_PATTERN.test(raw) || Number(raw) < 1) return null;
  return raw;
}

function readEnum<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = params.get(key);
  if (raw === null) return fallback;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function readDate(params: URLSearchParams, key: string): string | null {
  const raw = params.get(key);
  if (raw === null) return null;
  return isValidDateOnly(raw) ? raw : null;
}

/**
 * Parse a query string into a complete, self-consistent state.
 *
 * THREE CONSISTENCY RULES ARE APPLIED HERE rather than left to the components,
 * because a component that received an inconsistent state would have to invent
 * its own repair and two components could invent different ones:
 *
 *   1. A `custom` preset without two valid dates falls back to the default
 *      preset. A half-specified range has no interval to report on.
 *   2. `cutoffDate` is dropped outside cohort mode. It is a cohort-only input,
 *      and carrying it into an event-date URL would suggest it did something.
 *   3. `coverage` is forced to `attributed` whenever any dimension filter is
 *      set. The backend returns `unattributed`/`total` as NULL for a filtered
 *      request — events belonging to nobody cannot belong to the affiliate that
 *      was asked about — so any other value would name a slice that does not
 *      exist in the response.
 */
export function parseAnalyticsUrlState(search: string): AnalyticsUrlState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);

  const mode = readEnum(params, "mode", MODES, DEFAULT_ANALYTICS_STATE.mode);
  let preset = readEnum(params, "preset", PRESETS, DEFAULT_ANALYTICS_STATE.preset);

  let startDate = readDate(params, "startDate");
  let endDate = readDate(params, "endDate");

  if (preset === "custom" && (startDate === null || endDate === null)) {
    preset = DEFAULT_ANALYTICS_STATE.preset;
  }
  // Dates are meaningless beside a named preset, and the backend refuses the
  // combination outright (`crm.analytics.dates_not_allowed`).
  if (preset !== "custom") {
    startDate = null;
    endDate = null;
  }

  const affiliatePartnerId = readId(params, "affiliatePartnerId");
  const affiliateCampaignId = readId(params, "affiliateCampaignId");
  const affiliateTrackingLinkId = readId(params, "affiliateTrackingLinkId");
  const filtered =
    affiliatePartnerId !== null ||
    affiliateCampaignId !== null ||
    affiliateTrackingLinkId !== null;

  const rawOffset = params.get("offset");
  const offset =
    rawOffset !== null && /^\d{1,6}$/.test(rawOffset) && Number(rawOffset) <= 100_000
      ? Number(rawOffset)
      : 0;

  return {
    mode,
    preset,
    startDate,
    endDate,
    cutoffDate: mode === "acquisition_cohort" ? readDate(params, "cutoffDate") : null,
    group: readEnum(params, "group", GROUPS, DEFAULT_ANALYTICS_STATE.group),
    affiliatePartnerId,
    affiliateCampaignId,
    affiliateTrackingLinkId,
    dimension: readEnum(params, "dimension", DIMENSIONS, DEFAULT_ANALYTICS_STATE.dimension),
    coverage: filtered
      ? "attributed"
      : readEnum(params, "coverage", COVERAGES, DEFAULT_ANALYTICS_STATE.coverage),
    offset,
  };
}

/**
 * Serialize a state back to a query string, in ONE fixed key order.
 *
 * DEFAULTS ARE OMITTED, so the canonical URL of a freshly opened page is short
 * and two states that differ only in which fields were left at their defaults
 * produce the same string. That is what makes the round trip
 * `serialize(parse(x)) === serialize(parse(serialize(parse(x))))` hold, which is
 * in turn what stops a history entry being pushed for a no-op change.
 */
export function serializeAnalyticsUrlState(state: AnalyticsUrlState): string {
  const params = new URLSearchParams();

  if (state.mode !== DEFAULT_ANALYTICS_STATE.mode) params.set("mode", state.mode);
  if (state.preset !== DEFAULT_ANALYTICS_STATE.preset) params.set("preset", state.preset);
  if (state.preset === "custom") {
    if (state.startDate !== null) params.set("startDate", state.startDate);
    if (state.endDate !== null) params.set("endDate", state.endDate);
  }
  if (state.mode === "acquisition_cohort" && state.cutoffDate !== null) {
    params.set("cutoffDate", state.cutoffDate);
  }
  if (state.group !== DEFAULT_ANALYTICS_STATE.group) params.set("group", state.group);
  if (state.affiliatePartnerId !== null) {
    params.set("affiliatePartnerId", state.affiliatePartnerId);
  }
  if (state.affiliateCampaignId !== null) {
    params.set("affiliateCampaignId", state.affiliateCampaignId);
  }
  if (state.affiliateTrackingLinkId !== null) {
    params.set("affiliateTrackingLinkId", state.affiliateTrackingLinkId);
  }
  if (state.dimension !== DEFAULT_ANALYTICS_STATE.dimension) {
    params.set("dimension", state.dimension);
  }
  if (state.coverage !== DEFAULT_ANALYTICS_STATE.coverage) params.set("coverage", state.coverage);
  if (state.offset !== 0) params.set("offset", String(state.offset));

  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/**
 * Apply a partial change, repairing the dependent fields it invalidates.
 *
 * THE HIERARCHY CLEARS DOWNWARD, NEVER UPWARD. Choosing a different affiliate
 * drops the campaign and link that belonged to the old one; choosing a campaign
 * drops the link. Leaving a stale child would produce a hierarchy mismatch the
 * backend answers with a 400 — a self-inflicted error the operator did not make.
 *
 * ANY CHANGE EXCEPT PAGING RESETS `offset`. Staying on page 3 of a result set
 * that has just been replaced shows an empty page and reads as "no data".
 */
export function applyAnalyticsChange(
  state: AnalyticsUrlState,
  change: Partial<AnalyticsUrlState>,
): AnalyticsUrlState {
  const next: AnalyticsUrlState = { ...state, ...change };

  if ("affiliatePartnerId" in change && change.affiliatePartnerId !== state.affiliatePartnerId) {
    next.affiliateCampaignId = null;
    next.affiliateTrackingLinkId = null;
  }
  if ("affiliateCampaignId" in change && change.affiliateCampaignId !== state.affiliateCampaignId) {
    next.affiliateTrackingLinkId = null;
  }

  if (next.preset !== "custom") {
    next.startDate = null;
    next.endDate = null;
  }
  if (next.mode !== "acquisition_cohort") next.cutoffDate = null;

  const filtered =
    next.affiliatePartnerId !== null ||
    next.affiliateCampaignId !== null ||
    next.affiliateTrackingLinkId !== null;
  if (filtered) next.coverage = "attributed";

  // Paging is the one change that is allowed to keep its own offset.
  const pagingOnly = Object.keys(change).length === 1 && "offset" in change;
  if (!pagingOnly) next.offset = 0;

  return next;
}

/** The three dimension filters, as the client's query fields. */
export function filterQuery(state: AnalyticsUrlState) {
  return {
    ...(state.affiliatePartnerId !== null
      ? { affiliatePartnerId: state.affiliatePartnerId }
      : {}),
    ...(state.affiliateCampaignId !== null
      ? { affiliateCampaignId: state.affiliateCampaignId }
      : {}),
    ...(state.affiliateTrackingLinkId !== null
      ? { affiliateTrackingLinkId: state.affiliateTrackingLinkId }
      : {}),
  };
}

/** The period fields, as the client's query fields. */
export function periodQuery(state: AnalyticsUrlState) {
  return {
    preset: state.preset,
    ...(state.preset === "custom" && state.startDate !== null && state.endDate !== null
      ? { startDate: state.startDate, endDate: state.endDate }
      : {}),
  };
}

/** True when any dimension filter is active. */
export function isFiltered(state: AnalyticsUrlState): boolean {
  return (
    state.affiliatePartnerId !== null ||
    state.affiliateCampaignId !== null ||
    state.affiliateTrackingLinkId !== null
  );
}
