/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Hide the dev overlay indicator so it never leaks into screenshots.
  devIndicators: false,
  // Allow the loopback host used by the Playwright dev server (dev-only).
  allowedDevOrigins: ["127.0.0.1"],
  // No experimental features (Phase D1A constraint).
  // Concept routes under /concepts are development-only art-direction boards
  // and are intentionally excluded from the production sitemap.
};

export default nextConfig;
