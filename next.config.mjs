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
};

export default nextConfig;
