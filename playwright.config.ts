import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright runs against a real Next.js dev server (fonts are bundled via
 * @fontsource, so there is no external font fetch). Both the smoke suite and
 * the screenshot suite live under ./e2e.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100/concepts",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
