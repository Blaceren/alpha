/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Hide the dev overlay indicator so it never leaks into screenshots.
  devIndicators: false,
  // Allow the loopback and isolated showcase hosts used for dev-only QA.
  allowedDevOrigins: ["127.0.0.1", "57.128.213.204"],
  // No experimental features (Phase D1A constraint).
  // Concept routes under /concepts are development-only art-direction boards
  // and are intentionally excluded from the production sitemap.

  /**
   * H-8 — the hardening headers the Academy was serving none of.
   *
   * MEASURED FIRST, from the bytes the site actually serves. On /login, which
   * is the richest anonymous surface, the browser makes requests to exactly two
   * hosts: this origin, and challenges.cloudflare.com for Turnstile (a script
   * and an iframe). No data: image, no blob:, no web worker, no external font,
   * no cross-origin fetch. That inventory is what these values are cut to.
   *
   * WHY THERE IS NO script-src OR style-src HERE, AND WHAT IT WOULD TAKE.
   *
   * The page carries four inline <script> elements. All four are Next's own RSC
   * flight data — `self.__next_f.push(...)` — and not one is application code.
   * A CSP that constrains scripts therefore has exactly two options:
   *
   *   'unsafe-inline'  which permits precisely the class of injection the
   *                    directive exists to stop, and would make the header
   *                    decorative;
   *
   *   a per-request nonce  which Next supports, but only when middleware
   *                    generates it and sets the CSP on the REQUEST, and which
   *                    forces every document through that middleware on every
   *                    render. That is an architecture change, not a header.
   *
   * A CORRECTION TO AN EARLIER VERSION OF THIS NOTE. It said a nonce would cost
   * the static rendering of Public Home, /login and /register. It would not:
   * the prerender manifest lists only /_global-error and /_not-found, and those
   * three routes have always been rendered per request. The reason to hold the
   * full policy is the first option above, not the second.
   *
   * So script-src and style-src are deliberately absent, and this is reported
   * rather than guessed at. What ships is every header that needs no such
   * decision — including frame-ancestors, which is a CSP directive that
   * constrains nothing else and so cannot break Turnstile, Next, fonts or RSC.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Never let a browser re-interpret a response as a type it was not sent as.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // The Academy is same-origin throughout; send the origin outward and
          // the full path only to itself.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Nothing here uses any of these. Denying them costs nothing and
          // removes them from anything that ends up embedded in the page.
          {
            key: "Permissions-Policy",
            value: "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()",
          },
          // Framing protection, twice: the modern directive and the header old
          // browsers still honour. frame-ancestors takes precedence where both
          // are understood.
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
