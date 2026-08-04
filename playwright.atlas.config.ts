import { defineConfig, devices } from "@playwright/test";

/**
 * AFD-5D2 — the Curie Atlas browser journey, against a REAL backend.
 *
 * Separate from the mock, session and analytics configs because this one needs
 * the analysis endpoint served by the pinned backend candidate from a real,
 * migrated database with real fixture traffic. A stub could not prove that the
 * CRM renders the BACKEND's findings, because a stub's findings would be
 * whatever this repository decided they should be.
 *
 * THE BACKEND IS NOT STARTED HERE. It is migrated, seeded and started by
 * `tests-e2e-atlas/support/run-e2e.ts`, which owns its process group and stops
 * it recursively. Playwright starts only the CRM, pointed at that origin through
 * the same-origin rewrite. `ATLAS_E2E_BACKEND_ORIGIN` is required and has no
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

const CRM_PORT = requiredPort("ATLAS_E2E_CRM_PORT", 3681);

const BACKEND_ORIGIN = process.env.ATLAS_E2E_BACKEND_ORIGIN;
if (!BACKEND_ORIGIN) {
  throw new Error(
    "ATLAS_E2E_BACKEND_ORIGIN is required: this suite proves the CRM against the pinned " +
      "backend candidate and must never fall back to a stub.",
  );
}

export const ATLAS_E2E = {
  host: HOST,
  crmPort: CRM_PORT,
  baseURL: `http://${HOST}:${CRM_PORT}`,
  backendOrigin: BACKEND_ORIGIN,
  /** Used as a leak canary: this must never appear in the browser. */
  backendPortToken: new URL(BACKEND_ORIGIN).port,
  analyst: "afd5d3-e2e-analyst@example.invalid",
  password: process.env.ATLAS_E2E_PASSWORD ?? "CurieAtlasE2E123!",
} as const;

export default defineConfig({
  testDir: "./tests-e2e-atlas",
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: ATLAS_E2E.baseURL,
    trace: "off",
    // No screenshots: an artifact of a logged-in CRM is a credentialed image,
    // and the audit package must not contain one.
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `npx next dev --port ${CRM_PORT} --hostname ${HOST}`,
      url: `${ATLAS_E2E.baseURL}/login`,
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
