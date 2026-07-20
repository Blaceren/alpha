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
 * Exactly one path is proxied. Not `/api/crm/v1/:path*`, not `/api/:path*`:
 * a wildcard would expose every current and future backend route through the
 * CRM's origin, including ones never reviewed for it. Widening this must be a
 * deliberate decision each time, never a default.
 */
export const SESSION_PATH = "/api/crm/v1/session";

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

  return [{ source: SESSION_PATH, destination: `${origin}${SESSION_PATH}` }];
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
