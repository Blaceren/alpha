/**
 * The production Users-list owner filter — a narrow, closed set of exactly three
 * states that mirror the backend `owner` query enum (docs/CRM_USERS_V1.md →
 * Owner filter):
 *
 *   all         — no owner constraint (the canonical default)
 *   mine        — learners whose current owner is the authenticated employee
 *   unassigned  — learners with no current owner
 *
 * There is deliberately NO `assigned` value and NO specific-owner value: the
 * list never accepts, sends or renders an employee id. `mine` is resolved by the
 * backend from the session `StaffProfile` — the frontend never puts an employee
 * id on the wire. This module is the single source of truth for parsing the
 * filter out of a URL and writing the canonical filter back into one.
 */

export const CRM_USERS_OWNER_FILTERS = ["all", "mine", "unassigned"] as const;

export type CrmUsersOwnerFilter = (typeof CRM_USERS_OWNER_FILTERS)[number];

/** The one URL parameter carrying the filter. The existing `search` UI state is
 *  deliberately NOT a URL parameter and is left untouched. */
export const OWNER_FILTER_PARAM = "owner";

export function isOwnerFilter(value: unknown): value is CrmUsersOwnerFilter {
  return (CRM_USERS_OWNER_FILTERS as readonly unknown[]).includes(value);
}

/**
 * Derive the filter from URL search params, failing safe to `all`.
 *
 * Matched EXACTLY, like the backend — no trim, no case-folding:
 *   absent                       -> all
 *   exactly one "mine"           -> mine
 *   exactly one "unassigned"     -> unassigned
 *   exactly one "all"            -> all   (accepted, then canonicalized away)
 *   repeated (>1 value)          -> all   (a repeated key is malformed)
 *   "", "All", "MINE", garbage   -> all
 *
 * `all` is the only value the parser ever produces for anything invalid, so the
 * UI never shows a raw invalid value and the client never forwards one.
 */
export function readOwnerFilter(params: URLSearchParams): CrmUsersOwnerFilter {
  const values = params.getAll(OWNER_FILTER_PARAM);
  // Absent or repeated — neither is a single, well-formed value.
  if (values.length !== 1) return "all";
  const value = values[0];
  return value === "mine" || value === "unassigned" ? value : "all";
}

/**
 * Build the canonical search string for a target filter, preserving any other
 * params untouched. `all` omits the parameter entirely — the frontend never
 * writes `owner=all`, matching the backend's "omission means all" default. Any
 * pre-existing `owner` values (including repeats) are removed first, so an
 * incoming `?owner=all`, `?owner=MINE` or `?owner=mine&owner=all` collapses to
 * the one canonical form.
 *
 * Returns `""` for the empty query, or `?<params>` otherwise — ready to append
 * to a pathname.
 */
export function buildOwnerSearch(
  params: URLSearchParams,
  owner: CrmUsersOwnerFilter,
): string {
  const next = new URLSearchParams(params);
  next.delete(OWNER_FILTER_PARAM);
  if (owner !== "all") next.set(OWNER_FILTER_PARAM, owner);
  const query = next.toString();
  return query ? `?${query}` : "";
}

/** True when the URL's current search string is already the canonical form for
 *  `owner` — used to decide whether a canonicalizing `replace` is needed at all,
 *  so a well-formed `?owner=mine` never triggers a redundant history rewrite. */
export function isCanonicalOwnerSearch(search: string): boolean {
  const params = new URLSearchParams(search);
  const owner = readOwnerFilter(params);
  return buildOwnerSearch(params, owner) === normalizeLeadingQuestionMark(search);
}

function normalizeLeadingQuestionMark(search: string): string {
  if (search === "" || search === "?") return "";
  return search.startsWith("?") ? search : `?${search}`;
}
