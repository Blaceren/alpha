import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ANALYTICS_PATH,
  CREDENTIALS,
  signIn,
  waitForAllSections,
} from "./support/analytics-e2e";

/**
 * AFD-5C1 — the screenshot set the phase's visual review is performed against.
 *
 * These are EVIDENCE, not baselines: nothing is compared byte-for-byte, so a
 * font-rendering difference never fails the suite. The output directory is
 * supplied by the orchestrator and is outside the repository — screenshots are
 * never committed.
 *
 * Every shot is taken as the ANALYST, whose responses carry no learner
 * identity, so the images are safe to review and to attach to an audit.
 */

const OUT =
  process.env.ANALYTICS_E2E_SHOT_DIR ?? path.join(process.cwd(), ".analytics-screenshots");

test.beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
});

test.describe("screenshots", () => {
  test.beforeEach(async ({ context, request }) => {
    expect(await signIn(context, request, CREDENTIALS.analyst)).toBe(200);
  });

  test("event-date desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(`${ANALYTICS_PATH}?preset=all_time&group=month`);
    await waitForAllSections(page);
    await page.screenshot({ path: path.join(OUT, "01-event-date-desktop.png"), fullPage: true });
  });

  test("event-date 390", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${ANALYTICS_PATH}?preset=all_time&group=month`);
    await waitForAllSections(page);
    await page.screenshot({ path: path.join(OUT, "02-event-date-390.png"), fullPage: true });
  });

  test("cohort desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(`${ANALYTICS_PATH}?mode=acquisition_cohort&preset=all_time&group=month`);
    await waitForAllSections(page);
    await page.screenshot({ path: path.join(OUT, "03-cohort-desktop.png"), fullPage: true });
  });

  test("cohort 390", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${ANALYTICS_PATH}?mode=acquisition_cohort&preset=all_time&group=month`);
    await waitForAllSections(page);
    await page.screenshot({ path: path.join(OUT, "04-cohort-390.png"), fullPage: true });
  });

  test("breakdown table", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${ANALYTICS_PATH}?preset=all_time&dimension=tracking_link`);
    await waitForAllSections(page);
    const section = page.getByRole("heading", { name: "Детализация" }).locator("xpath=../..");
    await section.screenshot({ path: path.join(OUT, "05-breakdown-table.png") });
  });

  test("empty period", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    // "Today" contains no seeded traffic: the honest empty state.
    await page.goto(`${ANALYTICS_PATH}?preset=today`);
    await waitForAllSections(page);
    await page.screenshot({ path: path.join(OUT, "06-empty-period.png"), fullPage: true });
  });

  test("first-deposit currency state", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAllSections(page);
    const summary = page.getByRole("heading", { name: "Сводка" }).locator("xpath=../..");
    await summary.screenshot({ path: path.join(OUT, "07-fd-currency-state.png") });
  });

  test("access denied", async ({ page, context, request }) => {
    await context.clearCookies();
    expect(await signIn(context, request, CREDENTIALS.unauthorized)).toBe(200);
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto(ANALYTICS_PATH);
    await page.getByText("Недостаточно прав").waitFor();
    await page.screenshot({ path: path.join(OUT, "08-access-denied.png"), fullPage: true });
  });

  test("availability section", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAllSections(page);
    const section = page.getByRole("heading", { name: "Доступность данных" }).locator("xpath=../..");
    await section.screenshot({ path: path.join(OUT, "09-data-availability.png") });
  });
});
