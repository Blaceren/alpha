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
