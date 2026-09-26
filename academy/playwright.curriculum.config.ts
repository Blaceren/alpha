import { defineConfig, devices } from "@playwright/test";
import { ACADEMY_BASE_URL, ACADEMY_PORT, BACKEND_ORIGIN, HOST } from "./e2e-curriculum/support/config";

/**
 * Isolated API-mode curriculum-read E2E. The isolated Backend (3213, synthetic
 * curriculum) must already be running (globalSetup verifies it). Screenshots and
 * traces are OFF so no cookie value can be captured; artifacts go under the
 * gitignored test-results/ tree.
 */
export default defineConfig({
  testDir: "./e2e-curriculum",
  globalSetup: "./e2e-curriculum/support/global-setup.ts",
  outputDir: "./test-results/curriculum-e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: ACADEMY_BASE_URL, trace: "off", screenshot: "off", video: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${ACADEMY_PORT} --hostname ${HOST}`,
    url: `${ACADEMY_BASE_URL}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { ACADEMY_MODE: "api", BACKEND_ORIGIN },
  },
});
