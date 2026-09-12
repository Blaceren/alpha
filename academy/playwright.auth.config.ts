import { defineConfig, devices } from "@playwright/test";
import { ACADEMY_BASE_URL, ACADEMY_PORT, BACKEND_ORIGIN, HOST } from "./e2e-auth/support/e2e-auth-config";

/**
 * Isolated authentication E2E config.
 *
 * Runs the Academy in api mode (ACADEMY_MODE=api, BACKEND_ORIGIN) on the Academy
 * test port. The isolated Backend must already be running (globalSetup verifies
 * reachability). Screenshots/traces are OFF so the session cookie value can
 * never be captured. Failure artifacts (if enabled) go under the ignored
 * test-results/ tree, never design-memory/.
 */
export default defineConfig({
  testDir: "./e2e-auth",
  globalSetup: "./e2e-auth/support/global-setup.ts",
  outputDir: "./test-results/auth-e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: ACADEMY_BASE_URL,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${ACADEMY_PORT} --hostname ${HOST}`,
    url: `${ACADEMY_BASE_URL}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ACADEMY_MODE: "api",
      BACKEND_ORIGIN,
    },
  },
});
