import { defineConfig, devices } from "@playwright/test";
import { ACADEMY_E2E } from "./e2e/support/e2e-config";

/**
 * Playwright runs against a real Next.js dev server (fonts bundled via @fontsource,
 * so no external font fetch). Home scenarios via ?scenario=active|checkpoint.
 *
 * Host, port and server reuse come from `e2e/support/e2e-config.ts`. It defaults
 * to 127.0.0.1:3040 with reuse OFF, and refuses the live runtime ports
 * (3100/3010/3110/3020). Until TB-2 this file hard-coded port 3100 — now the
 * live DEV Backend port — with reuse enabled whenever CI was unset, so a local
 * run could silently drive the DEV runtime. Override with ACADEMY_E2E_PORT.
 */
const { host, port, baseURL, reuseExistingServer } = ACADEMY_E2E;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${port} --hostname ${host}`,
    // Derived from the same resolution as baseURL so the two cannot diverge.
    url: `${baseURL}/`,
    reuseExistingServer,
    timeout: 120_000,
  },
});
