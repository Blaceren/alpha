import { test, type Page } from "@playwright/test";
import { screenshotDir } from "./support/artifact-paths";
import fs from "node:fs";
import path from "node:path";

/** Phase D1B.2 — short-viewport / bottom-nav evidence screenshots. */
const OUT = screenshotDir("d1b-2-short-viewport-fix", "final");
fs.mkdirSync(OUT, { recursive: true });

const ZOOM_200 = { width: 720, height: 450 }; // == 200% browser zoom of 1440x900
const LANDSCAPE = { width: 844, height: 390 };
const W320 = { width: 320, height: 720 };
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 1024, height: 768 };

test.use({ deviceScaleFactor: 1 });

async function open(page: Page, size: { width: number; height: number }, scenario = "active") {
  await page.setViewportSize(size);
  await page.goto(`/?scenario=${scenario}`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(350);
}
function grab(page: Page, size: { width: number; height: number }, file: string) {
  return page.screenshot({ path: path.join(OUT, file), clip: { x: 0, y: 0, ...size } });
}
async function scrollTo(page: Page, selector: string) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
}

test("active zoom 200% — initial + CTA visible", async ({ page }) => {
  await open(page, ZOOM_200);
  await grab(page, ZOOM_200, "active-zoom-200-initial.png");
  await scrollTo(page, ".cta"); // CTA is already above the nav; center it to prove it
  await grab(page, ZOOM_200, "active-zoom-200-cta-visible.png");
});

test("active landscape — initial + CTA visible", async ({ page }) => {
  await open(page, LANDSCAPE);
  await grab(page, LANDSCAPE, "active-mobile-landscape-initial.png");
  await scrollTo(page, ".cta");
  await grab(page, LANDSCAPE, "active-mobile-landscape-cta-visible.png");
});

test("active 320 — initial + scrolled to Alex + scrolled to checkpoint preview", async ({ page }) => {
  await open(page, W320);
  await grab(page, W320, "active-mobile-320-initial.png");
  await scrollTo(page, ".mentor");
  await grab(page, W320, "active-mobile-320-alex-scrolled.png");
  await scrollTo(page, ".fcp");
  await grab(page, W320, "active-mobile-320-checkpoint-scrolled.png");
});

test("checkpoint mobile — regression initial + scrolled", async ({ page }) => {
  await open(page, MOBILE, "checkpoint");
  await grab(page, MOBILE, "checkpoint-mobile-regression.png");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(250);
  await grab(page, MOBILE, "checkpoint-mobile-regression-scrolled.png");
});

test("desktop + tablet regression (unchanged by D1B.2)", async ({ page }) => {
  await open(page, DESKTOP);
  await grab(page, DESKTOP, "active-desktop-regression.png");
  await open(page, TABLET);
  await grab(page, TABLET, "active-tablet-regression.png");
});
