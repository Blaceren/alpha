import { defineConfig, devices } from "@playwright/test";
import { ACADEMY_ON } from "./e2e-assessment/support/config";

/**
 * Isolated CI-3 assessment E2E. The harness (scripts/run-assessment-e2e.sh)
 * starts two isolated Backends (assessment ON / OFF) and two Academy servers on
 * scanned free ports, then runs these specs. Screenshots/traces/video OFF so no
 * cookie/CSRF/answer value is ever captured; artifacts go under gitignored
 * test-results/.
 */
export default defineConfig({
  testDir: "./e2e-assessment",
  globalSetup: "./e2e-assessment/support/global-setup.ts",
  outputDir: "./test-results/assessment-e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: ACADEMY_ON, trace: "off", screenshot: "off", video: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
