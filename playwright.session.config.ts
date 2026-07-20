import { defineConfig, devices } from "@playwright/test";

/**
 * API-mode session E2E config.
 *
 * Separate from playwright.config.ts because the two need different runtime
 * modes and different ports, and because the mock suite must stay exactly the
 * 156 tests it was. Two servers boot: the deterministic session stub, and the
 * CRM in api mode pointed at it through the same-origin rewrite.
 *
 * One worker: server RAM is constrained, and these tests drive a shared stub
 * whose response is selected by a cookie.
 */
const CRM_PORT = 3010;
const STUB_PORT = 3110;

export default defineConfig({
  testDir: "./tests-e2e-session",
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${CRM_PORT}`,
    trace: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Test-only backend stub. Node stdlib, loopback, one route.
      command: `node tests-e2e-session/support/session-stub.mjs`,
      port: STUB_PORT,
      timeout: 30_000,
      reuseExistingServer: false,
      env: { SESSION_STUB_PORT: String(STUB_PORT) },
    },
    {
      // The CRM in api mode. CRM_MODE is set explicitly — never defaulted.
      command: `npx next dev --port ${CRM_PORT}`,
      url: `http://127.0.0.1:${CRM_PORT}/today`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        CRM_MODE: "api",
        CRM_BACKEND_ORIGIN: `http://127.0.0.1:${STUB_PORT}`,
      },
    },
  ],
});
