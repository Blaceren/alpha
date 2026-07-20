import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright smoke config. Boots the app in mock/development mode and runs a tiny smoke suite.
 * No production integration, no external network.
 */
export default defineConfig({
  testDir: "./tests-e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000/today",
    timeout: 120_000,
    reuseExistingServer: true,
    // CRM_MODE is set explicitly — the app has no default and fails closed.
    env: { CRM_MODE: "mock" },
  },
});
