import { defineConfig, devices } from "@playwright/test";
import { SESSION_E2E } from "./tests-e2e-session/support/e2e-config";

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
 *
 * Ports come from `tests-e2e-session/support/e2e-config.ts`, which defaults to
 * 3031/3211 and REFUSES the live runtime ports (3100/3010/3110/3020). They were
 * hard-coded to 3010/3110 until TB-2, which made the suite unrunnable while the
 * DEV runtime was up. Override with CRM_E2E_PORT / CRM_E2E_STUB_PORT.
 */
const { host: HOST, crmPort: CRM_PORT, stubPort: STUB_PORT, baseURL } = SESSION_E2E;

export default defineConfig({
  testDir: "./tests-e2e-session",
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
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
      // Never attach to a process this run did not start: a stray listener on
      // this port would silently replace the deterministic stub.
      reuseExistingServer: false,
      env: { SESSION_STUB_PORT: String(STUB_PORT), SESSION_STUB_HOST: HOST },
    },
    {
      // The CRM in api mode. CRM_MODE is set explicitly — never defaulted.
      command: `npx next dev --port ${CRM_PORT} --hostname ${HOST}`,
      url: `${baseURL}/today`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        CRM_MODE: "api",
        CRM_BACKEND_ORIGIN: SESSION_E2E.backendOrigin,
      },
    },
  ],
});
