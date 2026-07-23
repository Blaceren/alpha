import { test, type Page } from "@playwright/test";
import { screenshotDir } from "./support/artifact-paths";
import fs from "node:fs";
import path from "node:path";

/** Output dir chosen via SHOT_OUT (first-pass | final). Phase D1B.1. */
const OUT = screenshotDir("d1b-1-responsive-fix", process.env.SHOT_OUT ?? "final");
fs.mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 1024, height: 768 };
const MOBILE = { width: 390, height: 844 };
const MOBILE_320 = { width: 320, height: 720 };
const MOBILE_LANDSCAPE = { width: 844, height: 390 };
/**
 * 200% browser zoom (Ctrl+) reflows: on a 1440x900 window the CSS layout viewport
 * halves to 720x450. We reproduce the *reflow* by halving the viewport — no CSS
 * scale()/zoom transform — so the assertion exercises the real responsive layout.
 */
const ZOOM_200 = { width: 720, height: 450 };

test.use({ deviceScaleFactor: 1 });

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(400);
}

async function shot(page: Page, url: string, size: { width: number; height: number }, file: string) {
  await page.setViewportSize(size);
  await page.goto(url, { waitUntil: "networkidle" });
  await settle(page);
  await page.screenshot({ path: path.join(OUT, file), clip: { x: 0, y: 0, ...size } });
}

test("active desktop 1440x900", async ({ page }) => shot(page, "/?scenario=active", DESKTOP, "active-desktop-1440x900.png"));
test("active tablet 1024x768", async ({ page }) => shot(page, "/?scenario=active", TABLET, "active-tablet-1024x768.png"));
test("active mobile 390x844", async ({ page }) => shot(page, "/?scenario=active", MOBILE, "active-mobile-390x844.png"));
test("active mobile 320", async ({ page }) => shot(page, "/?scenario=active", MOBILE_320, "active-mobile-320.png"));
test("active zoom 200% (reflow to 720x450)", async ({ page }) => shot(page, "/?scenario=active", ZOOM_200, "active-zoom-200.png"));

test("checkpoint desktop 1440x900", async ({ page }) => shot(page, "/?scenario=checkpoint", DESKTOP, "checkpoint-desktop-1440x900.png"));
test("checkpoint tablet 1024x768", async ({ page }) => shot(page, "/?scenario=checkpoint", TABLET, "checkpoint-tablet-1024x768.png"));
test("checkpoint mobile 390x844", async ({ page }) => shot(page, "/?scenario=checkpoint", MOBILE, "checkpoint-mobile-390x844.png"));

test("checkpoint mobile scrolled to the last outcome", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto("/?scenario=checkpoint", { waitUntil: "networkidle" });
  await settle(page);
  // Bring the last outcome into view (it must sit above the bottom nav after scroll).
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    const main = document.querySelector(".home-main");
    if (main) main.scrollTop = main.scrollHeight;
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "checkpoint-mobile-scrolled.png"), clip: { x: 0, y: 0, ...MOBILE } });
});

test("mobile landscape 844x390", async ({ page }) =>
  shot(page, "/?scenario=active", MOBILE_LANDSCAPE, "mobile-landscape.png"));
