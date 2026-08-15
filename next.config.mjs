/**
 * Next configuration.
 *
 * The only dynamic part is a single same-origin rewrite for the CRM session
 * endpoint, added exclusively when CRM_MODE=api.
 *
 * Both env keys are server-only (no NEXT_PUBLIC_ prefix), so neither is inlined
 * into the browser bundle. The validation below intentionally mirrors
 * `src/config/backend-origin.ts` — this file is ESM JavaScript loaded by the
 * Next CLI and cannot import the TypeScript source, so the rules are duplicated
 * rather than shared. `src/config/backend-origin.ts` is the documented source of
 * truth, and `src/config/next-rewrites.test.ts` pins both to the same behaviour.
 */

/** Strict absolute-origin parse: http(s), no credentials, query, hash or path. */
function parseBackendOrigin(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.search !== "" || url.hash !== "") return null;
  if (url.pathname !== "/") return null;
  return url.origin;
}

/**
 * Every proxied path is listed here explicitly. Not `/api/crm/v1/:path*`, not
 * `/api/:path*`: a wildcard would expose every current and future backend route
 * through the CRM's origin, including ones never reviewed for it. Each addition
 * is a deliberate decision, never a default — and each entry is an exact path,
 * so `/api/crm/v1/users/123` and `/api/crm/v1/users/extra` are not proxied.
 */
export const SESSION_PATH = "/api/crm/v1/session";
export const USERS_PATH = "/api/crm/v1/users";

/**
 * The one dynamic entry. `:userId` matches EXACTLY ONE path segment — it is not
 * `:userId*` and not a catch-all — so `/api/crm/v1/users/123/notes`,
 * `/api/crm/v1/users/123/owner` and `/api/crm/v1/users/123/extra` are not
 * proxied and fall through to the CRM app.
 *
 * A malformed single segment (`/api/crm/v1/users/mock_user_1`) IS forwarded,
 * and the backend answers with its own canonical 400. Identifier validation for
 * direct API requests is the backend's contract, not the proxy's.
 */
export const USER_DETAIL_PATH = "/api/crm/v1/users/:userId";

/**
 * CRM User Notes v1. Same single-segment `:userId` rule, plus an EXACT terminal
 * `/notes`. There is no `:noteId` child and no catch-all, so
 * `/api/crm/v1/users/123/notes/abc` and `/api/crm/v1/users/123/notes/extra` are
 * NOT proxied and fall through to the CRM app.
 *
 * GET and POST share this one definition — Next rewrites are method-agnostic,
 * and a method-specific variant would only create two things to keep in sync.
 * Notes v1 is append-only, so PUT/PATCH/DELETE reach a backend route that does
 * not implement them and fail safely there.
 */
export const USER_NOTES_PATH = "/api/crm/v1/users/:userId/notes";

/**
 * CRM Learner Owner v1 — owner-candidate directory. A flat, static path (no
 * parameter): candidacy is global, not scoped to one learner. There is no
 * `/owner-candidates/:something` child and no catch-all, so
 * `/api/crm/v1/owner-candidates/extra` is NOT proxied and falls through to the
 * CRM app.
 */
export const OWNER_CANDIDATES_PATH = "/api/crm/v1/owner-candidates";

/**
 * CRM Learner Owner v1 — the current-owner singleton. Same single-segment
 * `:userId` rule as detail/notes, plus an EXACT terminal `/owner`. There is no
 * `:employeeId` child, no `/owner/history` and no catch-all, so
 * `/api/crm/v1/users/123/owner/anything` is NOT proxied and falls through to
 * the CRM app.
 *
 * GET and PUT share this one definition — Next rewrites are method-agnostic. The
 * backend owner route implements exactly GET and PUT; POST/PATCH/DELETE reach it
 * and fail safely there. The immutable owner HISTORY is a separate terminal path
 * (below), never a child segment matched by this one.
 */
export const USER_OWNER_PATH = "/api/crm/v1/users/:userId/owner";

/**
 * CRM Learner Owner History (OH-1). Same single-segment `:userId` rule as
 * detail/notes/owner, plus an EXACT terminal `/owner/history`. There is no
 * `:historyId` child and no catch-all, so `/api/crm/v1/users/123/owner/history/x`
 * is NOT proxied and falls through to the CRM app. The backend history route
 * implements exactly GET; other methods reach it and fail safely there.
 */
export const USER_OWNER_HISTORY_PATH = "/api/crm/v1/users/:userId/owner/history";

/* --------------------------------------------- Mentor report review (MR-1R)
 *
 * Five exact reviewer paths, each a deliberate addition. `:submissionRef` matches
 * EXACTLY ONE segment and each command path ends in an exact terminal verb, so
 * `/report-submissions/x/y/z` and any unlisted verb are NOT proxied and fall
 * through to the CRM app.
 *
 * Note these are `/api/curriculum/v2/*`, not `/api/crm/v1/*`: report review is a
 * curriculum-domain capability the CRM consumes. Same backend origin, same
 * explicit-allowlist rule, no wildcard.
 *
 * The attachment routes are deliberately ABSENT. Attachments stay disabled, and a
 * path that is not listed cannot be called by accident.
 */
export const REVIEW_QUEUE_PATH = "/api/curriculum/v2/report-reviews/queue";
export const REVIEW_DETAIL_PATH = "/api/curriculum/v2/report-submissions/:submissionRef";
export const REVIEW_CLAIM_PATH = "/api/curriculum/v2/report-submissions/:submissionRef/claim";
export const REVIEW_REJECT_PATH = "/api/curriculum/v2/report-submissions/:submissionRef/reject";
export const REVIEW_APPROVE_PATH = "/api/curriculum/v2/report-submissions/:submissionRef/approve";

/**
 * G3 — Mentor Review. TWO paths, and deliberately only two.
 *
 * The mentor-review lifecycle has exactly two transitions: the learner's
 * `in_progress -> pending_review` (an Academy surface, never proxied here) and
 * the reviewer's `pending_review -> completed`. The reviewer therefore needs a
 * way to DISCOVER waiting work and a way to APPROVE one item, and nothing else.
 *
 * There is no claim, no release, no reassign and no reject entry, because the
 * canonical lifecycle has none of those transitions. Adding a rewrite for a
 * command the domain does not implement would advertise a workflow that does not
 * exist — and adding a REJECT path in particular would be inventing product
 * behaviour, which this phase must not do.
 *
 * `:progressId` matches EXACTLY ONE path segment — not `:progressId*`, not a
 * catch-all — so `/api/curriculum/v2/mentor-reviews/1/approve/extra` is NOT
 * proxied and falls through to the CRM app.
 */
export const MENTOR_REVIEW_QUEUE_PATH = "/api/curriculum/v2/mentor-reviews/queue";
export const MENTOR_REVIEW_APPROVE_PATH = "/api/curriculum/v2/mentor-reviews/:progressId/approve";

/* ------------------------------------------- Affiliate management (AFD-5A)
 *
 * Six exact paths — three collections and three single-segment details. Each
 * `:id` matches EXACTLY ONE segment and there is no catch-all, so
 * `/affiliates/partners/1/campaigns`, `/affiliates/tracking-links/1/activate`
 * and any unlisted child are NOT proxied and fall through to the CRM app.
 *
 * The PUBLIC acquisition route `/go/{publicCode}` is deliberately ABSENT. It is
 * learner-facing traffic served from the public origin, never something the CRM
 * origin should forward — and the CRM never needs to call it to display a link.
 * The AFD-4 Pocket postback paths are absent for the same reason.
 *
 * GET and the mutations share one definition per path; Next rewrites are
 * method-agnostic. The backend enforces `view_affiliate_analytics` on GET and
 * `manage_settings` + CSRF on POST/PATCH, so a proxied method the caller is not
 * entitled to fails there with a 403 rather than here.
 */
export const AFFILIATE_PARTNERS_PATH = "/api/crm/v1/affiliates/partners";
export const AFFILIATE_PARTNER_DETAIL_PATH = "/api/crm/v1/affiliates/partners/:partnerId";
export const AFFILIATE_CAMPAIGNS_PATH = "/api/crm/v1/affiliates/campaigns";
export const AFFILIATE_CAMPAIGN_DETAIL_PATH = "/api/crm/v1/affiliates/campaigns/:campaignId";
export const AFFILIATE_LINKS_PATH = "/api/crm/v1/affiliates/tracking-links";
export const AFFILIATE_LINK_DETAIL_PATH = "/api/crm/v1/affiliates/tracking-links/:linkId";

/* ------------------------------------------ Affiliate analytics (AFD-5C1)
 *
 * Seven exact, terminal, READ-ONLY paths — four event-date and three cohort.
 * Every one is a literal string: there is no `:id`, no `/analytics/:path*` and
 * no catch-all, so an analytics route added to the backend later is NOT proxied
 * until somebody adds it here on purpose.
 *
 * Next rewrites are method-agnostic, and these backend routes export only `GET`.
 * A POST reaching one of them finds no handler and fails there.
 */
/* ------------------------------- AFFILIATE-PLATFORM-V1: commercial control
 *
 * FOUR EXACT, TERMINAL PATHS. No parameter, no catch-all: every partner-user,
 * terms, qualification and delivery request is a query on a flat path, so no
 * child route can be reached through these entries.
 *
 * `partner-users` and `campaign-terms` are the only two that are ever mutated,
 * and only with POST/PATCH — there is no DELETE anywhere in this platform's
 * staff surface, because nothing about a partner principal or a commercial
 * price is deletable. Superseding is how a price changes; disabling is how
 * access ends.
 */
export const AFFILIATE_PARTNER_USERS_PATH = "/api/crm/v1/affiliates/partner-users";
export const AFFILIATE_CAMPAIGN_TERMS_PATH = "/api/crm/v1/affiliates/campaign-terms";
export const AFFILIATE_COMMISSIONS_PATH = "/api/crm/v1/affiliates/commissions";
export const AFFILIATE_POSTBACK_DELIVERIES_PATH =
  "/api/crm/v1/affiliates/postback-deliveries";

export const ANALYTICS_FILTERS_PATH = "/api/crm/v1/affiliates/analytics/filters";
export const ANALYTICS_SUMMARY_PATH = "/api/crm/v1/affiliates/analytics/summary";
export const ANALYTICS_TIMESERIES_PATH = "/api/crm/v1/affiliates/analytics/timeseries";
export const ANALYTICS_BREAKDOWN_PATH = "/api/crm/v1/affiliates/analytics/breakdown";
export const ANALYTICS_COHORT_SUMMARY_PATH =
  "/api/crm/v1/affiliates/analytics/cohorts/summary";
export const ANALYTICS_COHORT_TIMESERIES_PATH =
  "/api/crm/v1/affiliates/analytics/cohorts/timeseries";
export const ANALYTICS_COHORT_BREAKDOWN_PATH =
  "/api/crm/v1/affiliates/analytics/cohorts/breakdown";

/* --------------------------------------------------- Curie Atlas (AFD-5D2)
 *
 * One exact, terminal path. It is the FIRST analytics path that is not a GET:
 * the backend route exports only `POST`, because the analysis request carries a
 * mode, two period shapes, a cutoff, three filters, a grouping and a dimension,
 * which as a query string would be a URL nobody can review.
 *
 * Next rewrites are method-agnostic, so a GET reaching this path finds no
 * handler and fails at the backend. The backend independently enforces
 * `view_affiliate_analytics` AND a valid CSRF token, so a proxied method or a
 * caller not entitled to it fails there rather than here.
 *
 * It is listed separately from the seven read paths above because it is a
 * separate decision: AFD-5C1 deliberately proxied only literal read routes, and
 * "the analysis route is also under /analytics/" is not by itself a reason to
 * forward it.
 */
export const ANALYTICS_ANALYSIS_PATH = "/api/crm/v1/affiliates/analytics/analysis";

/* ---------------------------------------------- Affiliate leads (AFD-5C2)
 *
 * Three exact paths: the list, one lead, and that lead's PII reveal.
 *
 * `:leadId` matches EXACTLY ONE path segment — it is not `:leadId*` and not a
 * catch-all — so `/affiliates/leads/x/y` and any child other than the literal
 * `/reveal` are NOT proxied and fall through to the CRM app. There is no
 * `/leads/export`, no `/leads/bulk` and no `/leads/:leadId/reveal/:anything`,
 * because no such path is written here and the list is the whole allow-list.
 *
 * THE REVEAL IS ONE LEAD BY CONSTRUCTION. The proxied path names a single
 * segment, so there is no URL shape through this origin that could carry an id
 * array, a wildcard or a filter — a bulk reveal is not refused downstream, it is
 * unroutable.
 *
 * Next rewrites are method-agnostic. The backend list and detail routes export
 * only `GET` and the reveal route only `POST`, so a method that does not belong
 * to a path finds no handler and fails there — and the reveal additionally
 * requires `reveal_pii` and a valid CSRF token regardless of how it was reached.
 */
/* ------------------------------------------------- Growth (G4-GROWTH)
 *
 * Five exact, terminal, READ-ONLY paths. Every one is a literal string: there is
 * no `:id`, no `/growth/:path*` and no catch-all, so a growth route added to the
 * backend later is NOT proxied until somebody adds it here on purpose.
 *
 * The backend routes export only `GET`, so a POST reaching one finds no handler
 * and fails there. Each independently enforces the CRM affiliate-reader
 * authorization before any database read.
 *
 * DELIBERATELY ABSENT: the Pocket postback paths. They are provider-facing
 * traffic on the public origin and must never be reachable through the CRM
 * origin — the CRM reads the RESULT of provider events, never their intake.
 */
export const GROWTH_OVERVIEW_PATH = "/api/crm/v1/growth/overview";
export const GROWTH_FUNNEL_PATH = "/api/crm/v1/growth/funnel";
export const GROWTH_ACQUISITION_PATH = "/api/crm/v1/growth/acquisition";
export const GROWTH_POCKET_CONVERSIONS_PATH = "/api/crm/v1/growth/pocket-conversions";
export const GROWTH_INGRESS_HEALTH_PATH = "/api/crm/v1/growth/ingress-health";

export const AFFILIATE_LEADS_PATH = "/api/crm/v1/affiliates/leads";
export const AFFILIATE_LEAD_DETAIL_PATH = "/api/crm/v1/affiliates/leads/:leadId";
export const AFFILIATE_LEAD_REVEAL_PATH = "/api/crm/v1/affiliates/leads/:leadId/reveal";

/** The complete set of backend paths the CRM origin may forward. */
export const PROXIED_PATHS = [
  SESSION_PATH,
  USERS_PATH,
  USER_DETAIL_PATH,
  USER_NOTES_PATH,
  OWNER_CANDIDATES_PATH,
  USER_OWNER_PATH,
  USER_OWNER_HISTORY_PATH,
  REVIEW_QUEUE_PATH,
  REVIEW_DETAIL_PATH,
  REVIEW_CLAIM_PATH,
  REVIEW_REJECT_PATH,
  REVIEW_APPROVE_PATH,
  MENTOR_REVIEW_QUEUE_PATH,
  MENTOR_REVIEW_APPROVE_PATH,
  AFFILIATE_PARTNERS_PATH,
  AFFILIATE_PARTNER_DETAIL_PATH,
  AFFILIATE_CAMPAIGNS_PATH,
  AFFILIATE_CAMPAIGN_DETAIL_PATH,
  AFFILIATE_LINKS_PATH,
  AFFILIATE_LINK_DETAIL_PATH,
  AFFILIATE_PARTNER_USERS_PATH,
  AFFILIATE_CAMPAIGN_TERMS_PATH,
  AFFILIATE_COMMISSIONS_PATH,
  AFFILIATE_POSTBACK_DELIVERIES_PATH,
  ANALYTICS_FILTERS_PATH,
  ANALYTICS_SUMMARY_PATH,
  ANALYTICS_TIMESERIES_PATH,
  ANALYTICS_BREAKDOWN_PATH,
  ANALYTICS_COHORT_SUMMARY_PATH,
  ANALYTICS_COHORT_TIMESERIES_PATH,
  ANALYTICS_COHORT_BREAKDOWN_PATH,
  ANALYTICS_ANALYSIS_PATH,
  AFFILIATE_LEADS_PATH,
  AFFILIATE_LEAD_DETAIL_PATH,
  AFFILIATE_LEAD_REVEAL_PATH,
  GROWTH_OVERVIEW_PATH,
  GROWTH_FUNNEL_PATH,
  GROWTH_ACQUISITION_PATH,
  GROWTH_POCKET_CONVERSIONS_PATH,
  GROWTH_INGRESS_HEALTH_PATH,
];

export function buildRewrites(envSource = process.env) {
  const mode = envSource.CRM_MODE;

  // Mock mode proxies nothing and does not need a backend origin at all.
  if (mode !== "api") return [];

  const origin = parseBackendOrigin(envSource.CRM_BACKEND_ORIGIN);
  if (!origin) {
    throw new Error(
      "CRM_MODE=api requires a valid absolute CRM_BACKEND_ORIGIN " +
        "(http(s), no credentials, query, hash or path), e.g. http://127.0.0.1:3110.",
    );
  }

  return PROXIED_PATHS.map((path) => ({ source: path, destination: `${origin}${path}` }));
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No experimental features (DECISIONS D-03).
  async rewrites() {
    return buildRewrites();
  },
};

export default nextConfig;
