import { defineConfig, devices } from "@playwright/test";
import { REVIEW_E2E } from "./tests-e2e-review/support/review-e2e-config";

/**
 * MR-1R real-backend review E2E config.
 *
 * A fourth config, alongside the mock suite, the stub-backed session suite and the
 * CA-1 auth suite. This one needs the RR-1 Backend source running against a
 * seeded synthetic database.
 *
 * RF-1: that database and that backend are now created by `globalSetup` and
 * destroyed by `globalTeardown`, so the suite owns its whole fixture lifecycle.
 * Previously both were prepared by hand and survived between runs, and a run
 * inherited the decisions of the run before it.
 *
 * One worker: the suite drives a single database and the backend's in-memory login
 * rate limiter, so parallel workers would interfere with each other's fixtures.
 */
const { host: HOST, crmPort: CRM_PORT, baseURL, backendOrigin } = REVIEW_E2E;

export default defineConfig({
  testDir: "./tests-e2e-review",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./tests-e2e-review/global-setup.ts",
  globalTeardown: "./tests-e2e-review/global-teardown.ts",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // 15s rather than the 5s default: `next dev` compiles a route on its first hit,
  // and the review route is large. This grants more time and weakens no assertion.
  expect: { timeout: 15_000 },
  use: { baseURL, trace: "off", screenshot: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `npx next dev --port ${CRM_PORT} --hostname ${HOST}`,
      url: `${baseURL}/login`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        CRM_MODE: "api",
        CRM_BACKEND_ORIGIN: backendOrigin,
        // Loopback http: bridged cookies must not claim Secure, or nothing
        // authenticated would work and every failure would look opaque.
        NODE_ENV: "development",
      },
    },
  ],
});
