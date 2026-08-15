/**
 * AFFILIATE-PLATFORM-V1 §31/§32 — the partner console's Next configuration.
 *
 * ONE JOB: proxy an EXPLICIT LIST of partner API paths to the Backend, so the
 * browser only ever talks to this origin and the Backend is never publicly
 * reachable. This is the same construction the CRM already uses, and the same
 * rule applies: EVERY PROXIED PATH IS LISTED, never `/api/:path*`. A wildcard
 * would expose every current and future Backend route through the partner
 * origin, including ones never reviewed for a partner audience.
 *
 * THE ORIGIN IS SERVER-ONLY. `PARTNER_BACKEND_ORIGIN` has no NEXT_PUBLIC_
 * prefix, so it is never inlined into the browser bundle, and the browser only
 * ever calls relative paths.
 *
 * VALIDATION IS FAIL-CLOSED AND STRICT: absolute http(s) origin, no
 * credentials, no query, no hash, no path. A permissive origin is what turns a
 * same-origin proxy into an open one.
 */

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

const BACKEND_ORIGIN = parseBackendOrigin(process.env.PARTNER_BACKEND_ORIGIN);

/**
 * The complete list. Each entry is an exact path with no parameter and no
 * catch-all, so nothing added to the Backend later becomes reachable here
 * without an edit to this file.
 */
const PROXIED_PATHS = [
  "/api/partner/v1/session",
  "/api/partner/v1/overview",
  "/api/partner/v1/conversions",
  "/api/partner/v1/campaigns",
  "/api/partner/v1/tracking-links",
  "/api/partner/v1/postbacks",
  "/api/partner/v1/postbacks/rotate-secret",
  "/api/partner/v1/postbacks/deliveries",
  "/api/partner/v1/commissions",
  "/api/partner/v1/account/password",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    if (BACKEND_ORIGIN === null) return [];
    return PROXIED_PATHS.map((source) => ({
      source,
      destination: `${BACKEND_ORIGIN}${source}`,
    }));
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          // A partner console renders no third-party anything. The policy is
          // as narrow as a working Next app allows: `'unsafe-inline'` covers
          // the framework's own hydration style, and there is no external
          // origin of any kind in any directive.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "connect-src 'self'",
              "font-src 'self'",
              "object-src 'none'",
              "base-uri 'none'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
