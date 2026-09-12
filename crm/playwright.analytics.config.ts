import { defineConfig, devices } from "@playwright/test";

/**
 * AFD-5C1 — the affiliate analytics suite, against a REAL backend.
 *
 * Separate from the mock and session configs because this one needs something
 * neither of those provides: an actual backend serving the seven analytics
 * routes from a real, migrated database with real fixture traffic. A stub could
 * not prove that the CRM renders the BACKEND's buckets, because a stub's buckets
 * would be whatever this repo decided they should be.
 *
 * THE BACKEND IS NOT STARTED HERE. It is migrated, seeded and started by the
 * phase's isolated-journey orchestrator, which owns its process group and stops
 * it recursively. Playwright starts only the CRM, pointed at that origin through
 * the same-origin rewrite. `ANALYTICS_E2E_BACKEND_ORIGIN` is required and has no
 * default: a suite that silently fell back to a stub would report green while
 * proving nothing.
 *
 * ONE WORKER. Server RAM is constrained and an external root-owned model server
 * shares this host.
 */
const HOST = "127.0.0.1";

/** Ports owned by live runtimes. Binding one would collide with a real service. */
const FORBIDDEN_PORTS = [3100, 3010, 3110, 3020, 3050, 3200, 3300, 3400, 5177];

function requiredPort(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw.trim() === "" ? fallback : Number(raw.trim());
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be an integer port (received "${raw}").`);
  }
  if (FORBIDDEN_PORTS.includes(value)) {
    throw new Error(`${name}=${value} is reserved by a live runtime or an external listener.`);
  }
  return value;
}

const CRM_PORT = requiredPort("ANALYTICS_E2E_CRM_PORT", 3271);

const BACKEND_ORIGIN = process.env.ANALYTICS_E2E_BACKEND_ORIGIN;
if (!BACKEND_ORIGIN) {
  throw new Error(
    "ANALYTICS_E2E_BACKEND_ORIGIN is required: this suite proves the CRM against a real " +
      "analytics backend and must never fall back to a stub.",
  );
}

export const ANALYTICS_E2E = {
  host: HOST,
  crmPort: CRM_PORT,
  baseURL: `http://${HOST}:${CRM_PORT}`,
  backendOrigin: BACKEND_ORIGIN,
  /** Used as a leak canary: this must never appear in the browser. */
  backendPortToken: new URL(BACKEND_ORIGIN).port,
} as const;

export default defineConfig({
  testDir: "./tests-e2e-analytics",
  testMatch: /.*\.spec\.ts/,
  // Generous enough to absorb one login-limiter retry (65s) in the first
  // beforeEach of a re-run, without masking a genuine hang.
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: ANALYTICS_E2E.baseURL,
    trace: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `npx next dev --port ${CRM_PORT} --hostname ${HOST}`,
      url: `${ANALYTICS_E2E.baseURL}/login`,
      timeout: 180_000,
      // Never attach to a process this run did not start.
      reuseExistingServer: false,
      env: {
        CRM_MODE: "api",
        CRM_BACKEND_ORIGIN: BACKEND_ORIGIN,
      },
    },
  ],
});
