import { defineConfig, devices } from "@playwright/test";
import { AUTH_E2E } from "./tests-e2e-auth/support/auth-e2e-config";

/**
 * Real-backend staff authentication E2E config.
 *
 * A third config, separate from the mock suite and the stub-backed session suite,
 * because this one needs something neither of those has: the actual backend
 * source running against an isolated synthetic database. Only that can prove a
 * password is really verified, that the signed session cookie survives the bridge
 * intact, and that CSRF double-submit genuinely holds.
 *
 * The backend is NOT a `webServer` entry — it needs migrations and seeded fixture
 * identities applied before it is useful, so it is started and seeded outside
 * Playwright. `tests-e2e-auth/support/auth-e2e-config.ts` fails loudly if its
 * origin or the fixture credential is missing, so an absent backend surfaces as a
 * configuration error rather than a suite that silently proves nothing.
 *
 * One worker: the backend enforces per-IP login rate limits (5 per 10 minutes per
 * ip+email), and parallel workers sharing one loopback IP would exhaust the bucket
 * and produce spurious 429s.
 */
const { host: HOST, crmPort: CRM_PORT, baseURL, backendOrigin } = AUTH_E2E;

export default defineConfig({
  testDir: "./tests-e2e-auth",
  testMatch: /.*\.spec\.ts/,
  timeout: 45_000,
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
      // The CRM in api mode, pointed at the isolated backend. CRM_MODE is set
      // explicitly — never defaulted.
      command: `npx next dev --port ${CRM_PORT} --hostname ${HOST}`,
      url: `${baseURL}/login`,
      timeout: 120_000,
      // Never attach to a process this run did not start: a stray listener would
      // silently replace the CRM under test.
      reuseExistingServer: false,
      env: {
        CRM_MODE: "api",
        CRM_BACKEND_ORIGIN: backendOrigin,
        // Loopback http, so bridged cookies must not claim Secure — a Secure
        // cookie over http is never sent back and every test would fail opaquely.
        NODE_ENV: "development",
      },
    },
  ],
});
