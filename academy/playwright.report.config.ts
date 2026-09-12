import { defineConfig, devices } from "@playwright/test";
import { ACADEMY_ON } from "./e2e-report/support/config";

/**
 * Isolated CI-4 report E2E. The harness (scripts/run-report-e2e.sh) starts two
 * isolated RR-1 Backends (REPORT ON / OFF) each with a fresh synthetic DB (34
 * migrations + approved rev3 imported + real L3 report definition published/bound
 * + synthetic learners/mentor), and two Academy (api-mode) servers on scanned
 * free ports, then runs these specs. Screenshots/traces/video OFF so no
 * cookie/CSRF/report-prose value is ever captured; artifacts go under gitignored
 * test-results/.
 */
export default defineConfig({
  testDir: "./e2e-report",
  globalSetup: "./e2e-report/support/global-setup.ts",
  outputDir: "./test-results/report-e2e-artifacts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: ACADEMY_ON, trace: "off", screenshot: "off", video: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
