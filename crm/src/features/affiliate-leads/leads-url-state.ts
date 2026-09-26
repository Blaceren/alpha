/**
 * AFD-5C2 — the shareable lead-list state, and its exact URL grammar.
 *
 * WHY THE URL IS THE STATE. An operator who has narrowed a lead list to
 * "Аффилейт Alpha, конфликт депозита, июль" needs to send that to somebody. Every
 * control round-trips through the query string, and the component tree reads its
 * state FROM the parsed URL rather than keeping a second copy — so back, forward,
 * reload and a pasted link cannot disagree with what is on screen.
 *
 * WHAT MAY NEVER APPEAR HERE, AND WHY THE PARSER IS A CLOSED LIST. The keys are
 * exactly: three numeric dimension ids, three bounded enums, two independent
 * periods, a sort, a page size and an opaque cursor. There is no key for an
 * email, a name, a User id, a Pocket player id, a Pocket click id, an
 * `ataClickId`, an `anonymousVisitorId`, a session value, a CSRF token, an audit
 * id or a revealed identity. An unknown key is DROPPED rather than carried, so a
 * URL cannot be used to smuggle one of those into a link somebody shares — and,
 * because `serialize` writes only from this closed list, a revealed identity has
 * no representation that could reach the address bar even by accident.
 *
 * THE SELECTED LEAD IS A ROUTE, NOT A QUERY KEY. `/affiliates/leads/{leadId}`
 * carries the opaque `v1_…` reference, which is a 160-bit CSPRNG value the
 * backend generated and stores — not a hash of the User id, not an email, and
 * not a claim the holder can edit. Sharing that URL shares a redacted page.
 *
 * NORMALISATION IS TOTAL, AND IT NEVER THROWS. A hand-edited or truncated URL
 * must still open a usable page: every field falls back to its default when it
 * does not match the grammar. The BACKEND remains authoritative — a syntactically
 * valid affiliate id that does not exist is refused there with its own error, and
 * this parser deliberately does not pretend to know.
 */
import type {
  LeadAttributionState,
  LeadDatePreset,
  LeadDepositState,
  LeadJourneyStage,
  LeadSort,
} from "@/data/contracts/api/affiliate-leads";

/** One of the two independent windows. They are never merged or reinterpreted. */
export interface LeadPeriodState {
  /** Null means NO PREDICATE — see `DEFAULT_LEAD_STATE`. */
  preset: LeadDatePreset | null;
  /** `YYYY-MM-DD`, present only when `preset === "custom"`. */
  startDate: string | null;
  endDate: string | null;
}

export interface LeadsUrlState {
  affiliatePartnerId: string | null;
  affiliateCampaignId: string | null;
  affiliateTrackingLinkId: string | null;
  attributionState: LeadAttributionState | null;
  journeyStage: LeadJourneyStage | null;
  depositState: LeadDepositState | null;
  registration: LeadPeriodState;
  acquisition: LeadPeriodState;
  sort: LeadSort;
  pageSize: number;
  /** Opaque backend cursor. Never decoded, never parsed, never inspected. */
  cursor: string | null;
}

export const LEADS_DEFAULT_PAGE_SIZE = 25;
export const LEADS_MAX_PAGE_SIZE = 100;

const EMPTY_PERIOD: LeadPeriodState = { preset: null, startDate: null, endDate: null };

/**
 * No filter, no period, newest registration first.
 *
 * BOTH PERIODS DEFAULT TO ABSENT, matching the backend and deliberately unlike
 * the AFD-5C1 analytics screens. There, an omitted preset means `last_30_days`
 * because a chart without a window is meaningless. Here it must mean "no
 * predicate": a lead list that silently hid every registration older than thirty
 * days would be an operator searching for a learner they can see elsewhere in
 * the CRM and being told they do not exist.
 */
export const DEFAULT_LEAD_STATE: LeadsUrlState = {
  affiliatePartnerId: null,
  affiliateCampaignId: null,
  affiliateTrackingLinkId: null,
  attributionState: null,
  journeyStage: null,
  depositState: null,
  registration: EMPTY_PERIOD,
  acquisition: EMPTY_PERIOD,
  sort: "registration_desc",
  pageSize: LEADS_DEFAULT_PAGE_SIZE,
  cursor: null,
};

const PRESETS: readonly LeadDatePreset[] = [
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
const ATTRIBUTION_STATES: readonly LeadAttributionState[] = ["attributed", "unattributed"];
const JOURNEY_STAGES: readonly LeadJourneyStage[] = [
  "academy_registered",
  "pocket_registered",
  "first_deposit_confirmed",
];
const DEPOSIT_STATES: readonly LeadDepositState[] = [
  "none",
  "pending_identity",
  "conflict",
  "confirmed",
];
export const LEAD_SORTS: readonly LeadSort[] = [
  "registration_desc",
  "registration_asc",
  "acquisition_desc",
  "acquisition_asc",
  "pocket_registration_desc",
  "first_deposit_desc",
];

/**
 * A calendar date, validated as a real one.
 *
 * The regex alone would accept `2026-02-31`; the round-trip through `Date.UTC`
 * rejects it. An impossible date must never reach the backend as if it were a
 * period boundary. This is the ONLY date arithmetic in the feature, and it
 * decides validity — never a boundary.
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
  fallback: T | null,
): T | null {
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
 * One named period.
 *
 * A `custom` preset without two valid dates falls back to ABSENT, not to a
 * default window: a half-specified range has no interval, and inventing
 * `last_30_days` for it would silently hide leads the operator never excluded.
 */
function readPeriod(params: URLSearchParams, prefix: "registration" | "acquisition"): LeadPeriodState {
  const preset = readEnum(params, `${prefix}Preset`, PRESETS, null);
  if (preset === null) return EMPTY_PERIOD;

  if (preset !== "custom") return { preset, startDate: null, endDate: null };

  const startDate = readDate(params, `${prefix}StartDate`);
  const endDate = readDate(params, `${prefix}EndDate`);
  if (startDate === null || endDate === null) return EMPTY_PERIOD;
  return { preset: "custom", startDate, endDate };
}

/**
 * The one cross-field repair, applied at the parser so two components cannot
 * invent two different ones.
 *
 * An acquisition window names a SELECTED CLICK, which only an attributed lead
 * has. The backend refuses the combination outright
 * (`crm.leads.acquisition_period_requires_attribution`), so carrying it here
 * would guarantee a 400 the operator did not cause. The ACQUISITION PERIOD is
 * dropped rather than the attribution filter, because the explicitly chosen
 * "показать прямые регистрации" is the stronger statement of intent.
 */
function repairAcquisition(state: LeadsUrlState): LeadsUrlState {
  if (state.attributionState === "unattributed" && state.acquisition.preset !== null) {
    return { ...state, acquisition: EMPTY_PERIOD };
  }
  return state;
}

/**
 * An opaque cursor.
 *
 * ACCEPTED AS AN OPAQUE STRING AND NEVER DECODED. The browser does not
 * base64-decode it, does not read the row id inside it and does not validate its
 * fingerprint — doing any of those would make the CRM depend on a format the
 * backend documents as private, and would put an internal row id in browser
 * memory. It is bounded by length and character class only, so a truncated or
 * hand-edited value reaches the backend and receives the backend's own error.
 */
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

function readCursor(params: URLSearchParams): string | null {
  const raw = params.get("cursor");
  if (raw === null) return null;
  return CURSOR_PATTERN.test(raw) ? raw : null;
}

function readPageSize(params: URLSearchParams): number {
  const raw = params.get("pageSize");
  if (raw === null) return LEADS_DEFAULT_PAGE_SIZE;
  if (!/^\d{1,4}$/.test(raw)) return LEADS_DEFAULT_PAGE_SIZE;
  const value = Number(raw);
  if (value < 1 || value > LEADS_MAX_PAGE_SIZE) return LEADS_DEFAULT_PAGE_SIZE;
  return value;
}

/** Parse a query string into a complete, self-consistent state. */
export function parseLeadsUrlState(search: string): LeadsUrlState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);

  const state: LeadsUrlState = {
    affiliatePartnerId: readId(params, "affiliatePartnerId"),
    affiliateCampaignId: readId(params, "affiliateCampaignId"),
    affiliateTrackingLinkId: readId(params, "affiliateTrackingLinkId"),
    attributionState: readEnum(params, "attributionState", ATTRIBUTION_STATES, null),
    journeyStage: readEnum(params, "journeyStage", JOURNEY_STAGES, null),
    depositState: readEnum(params, "depositState", DEPOSIT_STATES, null),
    registration: readPeriod(params, "registration"),
    acquisition: readPeriod(params, "acquisition"),
    sort: readEnum(params, "sort", LEAD_SORTS, DEFAULT_LEAD_STATE.sort) ?? DEFAULT_LEAD_STATE.sort,
    pageSize: readPageSize(params),
    cursor: readCursor(params),
  };

  return repairAcquisition(state);
}

/**
 * Serialize a state back to a query string, in ONE fixed key order.
 *
 * DEFAULTS ARE OMITTED, so the canonical URL of a freshly opened page is empty
 * and two states that differ only in which fields were left at their defaults
 * produce the same string. That is what makes the round trip
 * `serialize(parse(x)) === serialize(parse(serialize(parse(x))))` hold, which is
 * in turn what stops a history entry being pushed for a no-op change.
 */
export function serializeLeadsUrlState(state: LeadsUrlState): string {
  const params = new URLSearchParams();

  if (state.affiliatePartnerId !== null) params.set("affiliatePartnerId", state.affiliatePartnerId);
  if (state.affiliateCampaignId !== null) {
    params.set("affiliateCampaignId", state.affiliateCampaignId);
  }
  if (state.affiliateTrackingLinkId !== null) {
    params.set("affiliateTrackingLinkId", state.affiliateTrackingLinkId);
  }
  if (state.attributionState !== null) params.set("attributionState", state.attributionState);
  if (state.journeyStage !== null) params.set("journeyStage", state.journeyStage);
  if (state.depositState !== null) params.set("depositState", state.depositState);

  for (const prefix of ["registration", "acquisition"] as const) {
    const period = state[prefix];
    if (period.preset === null) continue;
    params.set(`${prefix}Preset`, period.preset);
    if (period.preset === "custom") {
      if (period.startDate !== null) params.set(`${prefix}StartDate`, period.startDate);
      if (period.endDate !== null) params.set(`${prefix}EndDate`, period.endDate);
    }
  }

  if (state.sort !== DEFAULT_LEAD_STATE.sort) params.set("sort", state.sort);
  if (state.pageSize !== LEADS_DEFAULT_PAGE_SIZE) params.set("pageSize", String(state.pageSize));
  if (state.cursor !== null) params.set("cursor", state.cursor);

  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/**
 * Apply a partial change, repairing the dependent fields it invalidates.
 *
 * THE HIERARCHY CLEARS DOWNWARD, NEVER UPWARD. Choosing a different affiliate
 * drops the campaign and link that belonged to the old one; choosing a campaign
 * drops the link. Leaving a stale child would produce a hierarchy mismatch the
 * backend answers with an error the operator did not make.
 *
 * EVERY CHANGE EXCEPT PAGING RESETS THE CURSOR. A cursor is bound to a
 * fingerprint of every resolved filter, both periods and the sort; replaying one
 * against a changed query is a 400 by design. Clearing it here means changing a
 * filter returns to page one, which is also the only page that means anything in
 * a new ordering.
 */
export function applyLeadsChange(
  state: LeadsUrlState,
  change: Partial<LeadsUrlState>,
): LeadsUrlState {
  let next: LeadsUrlState = { ...state, ...change };

  if ("affiliatePartnerId" in change && change.affiliatePartnerId !== state.affiliatePartnerId) {
    next.affiliateCampaignId = null;
    next.affiliateTrackingLinkId = null;
  }
  if ("affiliateCampaignId" in change && change.affiliateCampaignId !== state.affiliateCampaignId) {
    next.affiliateTrackingLinkId = null;
  }

  next = repairAcquisition(next);

  // Paging is the one change allowed to set its own cursor.
  const pagingOnly = Object.keys(change).length === 1 && "cursor" in change;
  if (!pagingOnly) next.cursor = null;

  return next;
}

/** True when any filter or period narrows the population. */
export function isLeadsFiltered(state: LeadsUrlState): boolean {
  return (
    state.affiliatePartnerId !== null ||
    state.affiliateCampaignId !== null ||
    state.affiliateTrackingLinkId !== null ||
    state.attributionState !== null ||
    state.journeyStage !== null ||
    state.depositState !== null ||
    state.registration.preset !== null ||
    state.acquisition.preset !== null
  );
}

/** True when any dimension filter is active. */
export function hasDimensionFilter(state: LeadsUrlState): boolean {
  return (
    state.affiliatePartnerId !== null ||
    state.affiliateCampaignId !== null ||
    state.affiliateTrackingLinkId !== null
  );
}

/**
 * The state as the client's query fields.
 *
 * A period contributes its dates ONLY for `custom`; the backend refuses dates
 * beside a named preset (`crm.analytics.dates_not_allowed`), so sending them
 * would be a self-inflicted 400.
 */
export function leadListQueryFrom(state: LeadsUrlState) {
  const period = (prefix: "registration" | "acquisition") => {
    const value = state[prefix];
    if (value.preset === null) return {};
    if (value.preset !== "custom") return { [`${prefix}Preset`]: value.preset };
    if (value.startDate === null || value.endDate === null) return {};
    return {
      [`${prefix}Preset`]: value.preset,
      [`${prefix}StartDate`]: value.startDate,
      [`${prefix}EndDate`]: value.endDate,
    };
  };

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
    ...(state.attributionState !== null ? { attributionState: state.attributionState } : {}),
    ...(state.journeyStage !== null ? { journeyStage: state.journeyStage } : {}),
    ...(state.depositState !== null ? { depositState: state.depositState } : {}),
    ...period("registration"),
    ...period("acquisition"),
    sort: state.sort,
    limit: state.pageSize,
    ...(state.cursor !== null ? { cursor: state.cursor } : {}),
  };
}
