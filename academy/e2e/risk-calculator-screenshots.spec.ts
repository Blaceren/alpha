import { test, type Page } from "@playwright/test";
import { screenshotDir } from "./support/artifact-paths";
import path from "node:path";

/**
 * Risk Calculator screenshots (D4-C) — ARTIFACT ONLY. This filename does NOT
 * match `smoke.spec.ts`, so it is excluded from the mandatory `npm run test:e2e`
 * behavioural gate; run it explicitly to (re)generate the visual-QA set.
 *
 * Pass is chosen with RISK_SHOT_PASS (first-pass | final; default final).
 * first-pass captures exactly the five review images; final captures the full
 * fifteen. Every capture is viewport-clipped so PNG dimensions match the
 * filename exactly (Desktop Chrome deviceScaleFactor = 1). Output lives ONLY
 * under the gitignored test-results/screenshots/d4-risk-calculator/<pass>/.
 */

const PASS = process.env.RISK_SHOT_PASS === "first-pass" ? "first-pass" : "final";
const OUT = screenshotDir("d4-risk-calculator", PASS);
const RISK = "/tools/tool.risk_calculator";

async function ready(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300); // let the measured band + strip settle
}

async function shot(page: Page, name: string, w: number, h: number) {
  await page.screenshot({ path: path.join(OUT, name), clip: { x: 0, y: 0, width: w, height: h } });
}

async function fill(
  page: Page,
  v: Partial<Record<"capital" | "risk" | "entry" | "stop", string>>,
) {
  if (v.capital !== undefined) await page.getByLabel("Расчётный капитал").fill(v.capital);
  if (v.risk !== undefined) await page.getByLabel("Риск на сделку, %").fill(v.risk);
  if (v.entry !== undefined) await page.getByLabel("Цена входа").fill(v.entry);
  if (v.stop !== undefined) await page.getByLabel("Стоп-цена").fill(v.stop);
}

const LONG = { capital: "1000", risk: "2", entry: "100", stop: "96" };
const SHORT = { capital: "1000", risk: "2", entry: "100", stop: "104" };
const TINY = { capital: "1000", risk: "1", entry: "100", stop: "99.9999" };

/* ============================ shared captures ============================ *
 * These five are the first-pass review set AND part of the final set.
 * ======================================================================== */

test("tools-hub-risk-available-desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tools?scenario=active", { waitUntil: "networkidle" });
  await ready(page);
  await shot(page, "tools-hub-risk-available-desktop-1440x900.png", 1440, 900);
});

test("risk-calculator-empty-desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(RISK, { waitUntil: "networkidle" });
  await ready(page);
  await shot(page, "risk-calculator-empty-desktop-1440x900.png", 1440, 900);
});

test("risk-calculator-long-desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(RISK, { waitUntil: "networkidle" });
  await fill(page, LONG);
  await ready(page);
  await shot(page, "risk-calculator-long-desktop-1440x900.png", 1440, 900);
});

test("risk-calculator-mobile-long", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(RISK, { waitUntil: "networkidle" });
  await fill(page, LONG);
  await ready(page);
  await shot(page, "risk-calculator-mobile-long-390x844.png", 390, 844);
});

test("risk-calculator-locked-desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${RISK}?scenario=early`, { waitUntil: "networkidle" });
  await ready(page);
  await shot(page, "risk-calculator-locked-desktop-1440x900.png", 1440, 900);
});

/* ============================ final-only captures ============================ */

test("risk-calculator-partial-desktop", async ({ page }) => {
  test.skip(PASS !== "final", "final set only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(RISK, { waitUntil: "networkidle" });
  await fill(page, { capital: "1000", risk: "2" });
  await ready(page);
  await shot(page, "risk-calculator-partial-desktop-1440x900.png", 1440, 900);
});

test("risk-calculator-invalid-desktop", async ({ page }) => {
  test.skip(PASS !== "final", "final set only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(RISK, { waitUntil: "networkidle" });
  await fill(page, { ...LONG, stop: "100" });
  await ready(page);
  await shot(page, "risk-calculator-invalid-desktop-1440x900.png", 1440, 900);
});

test("risk-calculator-short-desktop", async ({ page }) => {
  test.skip(PASS !== "final", "final set only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(RISK, { waitUntil: "networkidle" });
  await fill(page, SHORT);
  await ready(page);
  await shot(page, "risk-calculator-short-desktop-1440x900.png", 1440, 900);
});

test("risk-calculator-tiny-distance-desktop", async ({ page }) => {
  test.skip(PASS !== "final", "final set only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(RISK, { waitUntil: "networkidle" });
  await fill(page, TINY);
  await ready(page);
  await shot(page, "risk-calculator-tiny-distance-desktop-1440x900.png", 1440, 900);
});

test("risk-calculator-tablet", async ({ page }) => {
  test.skip(PASS !== "final", "final set only");
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(RISK, { waitUntil: "networkidle" });
  await fill(page, LONG);
  await ready(page);
  await shot(page, "risk-calculator-tablet-1024x768.png", 1024, 768);
});

test("tools-hub-risk-available-mobile", async ({ page }) => {
  test.skip(PASS !== "final", "final set only");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools?scenario=active", { waitUntil: "networkidle" });
  await ready(page);
  await shot(page, "tools-hub-risk-available-mobile-390x844.png", 390, 844);
});

test("risk-calculator-mobile-empty", async ({ page }) => {
  test.skip(PASS !== "final", "final set only");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(RISK, { waitUntil: "networkidle" });
  await ready(page);
  await shot(page, "risk-calculator-mobile-empty-390x844.png", 390, 844);
});

test("risk-calculator-mobile-invalid", async ({ page }) => {
  test.skip(PASS !== "final", "final set only");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(RISK, { waitUntil: "networkidle" });
  await fill(page, { ...LONG, stop: "100" });
  await ready(page);
  await shot(page, "risk-calculator-mobile-invalid-390x844.png", 390, 844);
});

test("risk-calculator-mobile-320", async ({ page }) => {
  test.skip(PASS !== "final", "final set only");
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(RISK, { waitUntil: "networkidle" });
  await fill(page, LONG);
  await ready(page);
  await shot(page, "risk-calculator-mobile-320x720.png", 320, 720);
});

test("risk-calculator-zoom-200", async ({ page }) => {
  test.skip(PASS !== "final", "final set only");
  // 720×450 layout viewport == a 1440×900 window at 200% zoom (compact reflow).
  await page.setViewportSize({ width: 720, height: 450 });
  await page.goto(RISK, { waitUntil: "networkidle" });
  await fill(page, LONG);
  await ready(page);
  await shot(page, "risk-calculator-zoom-200-720x450.png", 720, 450);
});
