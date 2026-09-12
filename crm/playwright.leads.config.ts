import { defineConfig, devices } from "@playwright/test";

/**
 * AFD-5C2 — the affiliate lead suite, against a REAL backend.
 *
 * Separate from the mock, session and analytics configs because this one needs
 * something none of those provides: an actual backend serving the three lead
 * routes from a real, migrated database with a real lead population. A stub
 * could not prove that the CRM keeps a lead redacted, because a stub's
 * redaction would be whatever this repo decided it should be — and it could not
 * prove that a reveal is audited, because a stub writes no audit row.
 *
 * THE BACKEND IS NOT STARTED HERE. It is migrated, seeded and started by the
 * phase's isolated-journey orchestrator, which owns its process group and stops
 * it recursively. `LEADS_E2E_BACKEND_ORIGIN` is required and has no default: a
 * suite that silently fell back to a stub would report green while proving
 * nothing about privacy.
 *
 * ONE WORKER. Server RAM is constrained and an external root-owned model server
 * shares this host. Serial execution also keeps the login rate limiter — five
 * attempts per (IP, email) in ten minutes — comfortably out of reach.
 */
const HOST = "127.0.0.1";

/** Ports owned by live runtimes or by pre-existing external listeners. */
const FORBIDDEN_PORTS = [3100, 3010, 3110, 3020, 3050, 3200, 3300, 3400, 5177, 8000, 8090, 8443];

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

const CRM_PORT = requiredPort("LEADS_E2E_CRM_PORT", 3920);

const BACKEND_ORIGIN = process.env.LEADS_E2E_BACKEND_ORIGIN;
if (!BACKEND_ORIGIN) {
  throw new Error(
    "LEADS_E2E_BACKEND_ORIGIN is required: this suite proves the CRM against a real lead " +
      "backend and must never fall back to a stub.",
  );
}

const FIXTURES = process.env.LEADS_E2E_FIXTURES;
if (!FIXTURES) {
  throw new Error("LEADS_E2E_FIXTURES is required: it names the seeded lead population.");
}

export const LEADS_E2E = {
  host: HOST,
  crmPort: CRM_PORT,
  baseURL: `http://${HOST}:${CRM_PORT}`,
  backendOrigin: BACKEND_ORIGIN,
  fixturesPath: FIXTURES,
  /** Used as a leak canary: this must never appear in the browser. */
  backendPortToken: new URL(BACKEND_ORIGIN).port,
} as const;

export default defineConfig({
  testDir: "./tests-e2e-leads",
  testMatch: /.*\.spec\.ts/,
  // Generous enough to absorb one login-limiter retry (65s) in the first
  // beforeEach of a re-run, without masking a genuine hang.
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: LEADS_E2E.baseURL,
    trace: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `npx next dev --port ${CRM_PORT} --hostname ${HOST}`,
      url: `${LEADS_E2E.baseURL}/login`,
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
