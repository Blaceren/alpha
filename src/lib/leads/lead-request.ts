/**
 * AFD-5B2B — the closed query contract for the lead list.
 *
 * EVERY ACCEPTED KEY IS NAMED HERE and anything else is a 400. A silently
 * dropped parameter is the failure mode where an operator believes they are
 * looking at one affiliate's leads and is in fact looking at everybody's.
 *
 * NO PARAMETER EXISTS for an email, a name, a password, a Pocket player id, a
 * Pocket click id, an external affiliate click id, an `ataClickId`, a visitor
 * id, a raw column name or a sort direction of the caller's own devising. They
 * are absent from the unions below, so no request can reach them — see §23 on
 * why identity search is deferred rather than restricted.
 */
import { AffiliateInputError } from "@/lib/crm/affiliates";
import {
  AnalyticsPeriodError,
  DATE_PRESETS,
  resolvePeriod,
  type DatePreset,
  type ResolvedPeriod,
} from "@/lib/analytics/periods";
import type { AnalyticsFilters } from "@/lib/analytics/affiliate-sources";
import {
  LEAD_DEPOSIT_STATES,
  LEAD_JOURNEY_STAGES,
  type LeadDepositState,
  type LeadJourneyStage,
} from "@/lib/leads/lead-state";
import { cursorFingerprint, decodeLeadCursor, type LeadCursor } from "@/lib/leads/lead-cursor";

export const LEADS_DEFAULT_PAGE_SIZE = 25;
export const LEADS_MAX_PAGE_SIZE = 100;

/**
 * The complete sort vocabulary. A closed union, never a column name from the
 * request: there is no way to spell an ORDER BY that this module did not write.
 */
export const LEAD_SORTS = [
  "registration_desc",
  "registration_asc",
  "acquisition_desc",
  "acquisition_asc",
  "pocket_registration_desc",
  "first_deposit_desc",
] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];
export const LEAD_DEFAULT_SORT: LeadSort = "registration_desc";

export const LEAD_ATTRIBUTION_STATES = ["attributed", "unattributed"] as const;
export type LeadAttributionState = (typeof LEAD_ATTRIBUTION_STATES)[number];

/** Every key this route will answer to. */
export const LEAD_LIST_QUERY_KEYS = [
  "affiliatePartnerId",
  "affiliateCampaignId",
  "affiliateTrackingLinkId",
  "attributionState",
  "journeyStage",
  "depositState",
  "registrationPreset",
  "registrationStartDate",
  "registrationEndDate",
  "acquisitionPreset",
  "acquisitionStartDate",
  "acquisitionEndDate",
  "sort",
  "limit",
  "cursor",
] as const;

export type LeadListQuery = {
  readonly filters: AnalyticsFilters;
  readonly attributionState: LeadAttributionState | null;
  readonly journeyStage: LeadJourneyStage | null;
  readonly depositState: LeadDepositState | null;
  readonly registrationPeriod: ResolvedPeriod | null;
  readonly acquisitionPeriod: ResolvedPeriod | null;
  readonly sort: LeadSort;
  readonly limit: number;
  readonly cursor: LeadCursor | null;
  /** The digest the cursor is bound to, echoed by the encoder for the next page. */
  readonly fingerprint: string;
};

function parseId(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;
  const text = raw.trim();
  if (!/^\d{1,9}$/.test(text)) throw new AffiliateInputError("crm.leads.filter_invalid");
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1) {
    throw new AffiliateInputError("crm.leads.filter_invalid");
  }
  return value;
}

function parseEnum<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
  messageKey: string,
): T | null {
  const raw = params.get(key);
  if (raw === null) return null;
  if (!(allowed as readonly string[]).includes(raw)) throw new AffiliateInputError(messageKey);
  return raw as T;
}

/**
 * One period, under its own key prefix.
 *
 * BOTH PERIODS ARE OPTIONAL AND DEFAULT TO ABSENT, which is the one place this
 * route deliberately diverges from the AFD-5B1 analytics routes. There, an
 * omitted preset means `last_30_days` because a chart without a window is
 * meaningless. Here it must mean "no predicate": a lead list that silently hid
 * every registration older than thirty days would be an operator searching for
 * a learner they can see in the CRM and being told they do not exist. The
 * result set is bounded by the cursor and the page size, not by a period nobody
 * asked for.
 *
 * The resolution itself is the canonical AFD-5B1 owner, unchanged: Europe/
 * Moscow, Monday week start, [start, end), strict date-only custom ranges.
 */
function parseNamedPeriod(
  params: URLSearchParams,
  prefix: "registration" | "acquisition",
  timezone: string,
  now: Date,
): ResolvedPeriod | null {
  const presetKey = `${prefix}Preset`;
  const startKey = `${prefix}StartDate`;
  const endKey = `${prefix}EndDate`;

  const rawPreset = params.get(presetKey);
  const startDate = params.get(startKey);
  const endDate = params.get(endKey);

  if (rawPreset === null) {
    // Dates without a preset are refused rather than assumed to mean `custom`:
    // the caller who wrote them may equally have meant to name a preset and
    // mistyped it, and guessing produces a window nobody chose.
    if (startDate !== null || endDate !== null) {
      throw new AnalyticsPeriodError("crm.leads.period_preset_required");
    }
    return null;
  }

  const preset = rawPreset as DatePreset;
  if (!DATE_PRESETS.includes(preset)) {
    throw new AnalyticsPeriodError("crm.analytics.preset_invalid");
  }
  if (preset !== "custom" && (startDate !== null || endDate !== null)) {
    throw new AnalyticsPeriodError("crm.analytics.dates_not_allowed");
  }

  return resolvePeriod(
    {
      preset,
      ...(startDate !== null ? { startDate } : {}),
      ...(endDate !== null ? { endDate } : {}),
    },
    timezone,
    now,
  );
}

function parseLimit(params: URLSearchParams): number {
  const raw = params.get("limit");
  if (raw === null) return LEADS_DEFAULT_PAGE_SIZE;
  const text = raw.trim();
  if (!/^\d{1,4}$/.test(text)) throw new AffiliateInputError("crm.leads.limit_invalid");
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > LEADS_MAX_PAGE_SIZE) {
    throw new AffiliateInputError("crm.leads.limit_invalid");
  }
  return value;
}

/**
 * The canonical description the cursor fingerprint is taken over.
 *
 * Ordered and fully spelled out, including the nulls. Two requests that mean
 * the same thing produce the same string; two that differ in ANY predicate — or
 * in the sort — produce different ones, which is what makes a replayed cursor
 * from another query a detectable error rather than a wrong page.
 *
 * The page size is deliberately NOT part of it. Changing how many rows you ask
 * for does not change what the rows are or how they are ordered, so a cursor
 * stays valid across it.
 */
export function canonicalLeadQuery(input: {
  filters: AnalyticsFilters;
  attributionState: LeadAttributionState | null;
  journeyStage: LeadJourneyStage | null;
  depositState: LeadDepositState | null;
  registrationPeriod: ResolvedPeriod | null;
  acquisitionPeriod: ResolvedPeriod | null;
  sort: LeadSort;
}): string {
  const period = (value: ResolvedPeriod | null) =>
    value === null
      ? "-"
      : `${value.startUtc === null ? "-" : value.startUtc.toISOString()}..${value.endUtc.toISOString()}`;

  return [
    `partner=${input.filters.affiliatePartnerId ?? "-"}`,
    `campaign=${input.filters.affiliateCampaignId ?? "-"}`,
    `link=${input.filters.affiliateTrackingLinkId ?? "-"}`,
    `attribution=${input.attributionState ?? "-"}`,
    `stage=${input.journeyStage ?? "-"}`,
    `deposit=${input.depositState ?? "-"}`,
    `registration=${period(input.registrationPeriod)}`,
    `acquisition=${period(input.acquisitionPeriod)}`,
    `sort=${input.sort}`,
  ].join("|");
}

/**
 * Parse the whole query.
 *
 * ORDER MATTERS: the fingerprint is computed from the RESOLVED query and the
 * cursor is decoded against it, so a cursor can never be validated against
 * filters the caller did not actually send.
 */
export function parseLeadListQuery(
  params: URLSearchParams,
  timezone: string,
  now: Date,
): LeadListQuery {
  for (const key of new Set(params.keys())) {
    if (!(LEAD_LIST_QUERY_KEYS as readonly string[]).includes(key)) {
      throw new AffiliateInputError("crm.leads.query_unknown");
    }
    // Duplicates are refused rather than last-wins: `?sort=a&sort=b` has no
    // defensible meaning and choosing one silently is how two callers get
    // different answers from the same URL.
    if (params.getAll(key).length > 1) throw new AffiliateInputError("crm.leads.query_duplicated");
  }

  const filters: AnalyticsFilters = {
    ...(parseId(params, "affiliatePartnerId") !== undefined
      ? { affiliatePartnerId: parseId(params, "affiliatePartnerId") }
      : {}),
    ...(parseId(params, "affiliateCampaignId") !== undefined
      ? { affiliateCampaignId: parseId(params, "affiliateCampaignId") }
      : {}),
    ...(parseId(params, "affiliateTrackingLinkId") !== undefined
      ? { affiliateTrackingLinkId: parseId(params, "affiliateTrackingLinkId") }
      : {}),
  };

  const attributionState = parseEnum(
    params,
    "attributionState",
    LEAD_ATTRIBUTION_STATES,
    "crm.leads.attribution_state_invalid",
  );
  const journeyStage = parseEnum(
    params,
    "journeyStage",
    LEAD_JOURNEY_STAGES,
    "crm.leads.journey_stage_invalid",
  );
  const depositState = parseEnum(
    params,
    "depositState",
    LEAD_DEPOSIT_STATES,
    "crm.leads.deposit_state_invalid",
  );

  const registrationPeriod = parseNamedPeriod(params, "registration", timezone, now);
  const acquisitionPeriod = parseNamedPeriod(params, "acquisition", timezone, now);

  // An acquisition window names a SELECTED CLICK, which only an attributed lead
  // has. Combining it with `attributionState=unattributed` is a contradiction
  // that would silently return nothing, so it is refused with a reason.
  if (acquisitionPeriod !== null && attributionState === "unattributed") {
    throw new AffiliateInputError("crm.leads.acquisition_period_requires_attribution");
  }

  const sort = parseEnum(params, "sort", LEAD_SORTS, "crm.leads.sort_invalid") ?? LEAD_DEFAULT_SORT;
  const limit = parseLimit(params);

  const fingerprint = cursorFingerprint(
    canonicalLeadQuery({
      filters,
      attributionState,
      journeyStage,
      depositState,
      registrationPeriod,
      acquisitionPeriod,
      sort,
    }),
  );

  let cursor: LeadCursor | null = null;
  const rawCursor = params.get("cursor");
  if (rawCursor !== null) {
    if (rawCursor.trim() === "") throw new AffiliateInputError("crm.leads.cursor_invalid");
    cursor = decodeLeadCursor(rawCursor, fingerprint);
  }

  return {
    filters,
    attributionState,
    journeyStage,
    depositState,
    registrationPeriod,
    acquisitionPeriod,
    sort,
    limit,
    cursor,
    fingerprint,
  };
}
