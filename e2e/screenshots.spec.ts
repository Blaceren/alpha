import { test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/** Output dir chosen via SHOT_OUT (first-pass | final). */
const OUT = path.join(
  process.cwd(),
  "design-memory/screenshots/d1b-react-home",
  process.env.SHOT_OUT ?? "final",
);
fs.mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 1024, height: 768 };
const MOBILE = { width: 390, height: 844 };

test.use({ deviceScaleFactor: 1 });

async function shot(page: Page, url: string, size: { width: number; height: number }, file: string) {
  await page.setViewportSize(size);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, file), clip: { x: 0, y: 0, ...size } });
}

test("active desktop 1440x900", async ({ page }) => shot(page, "/?scenario=active", DESKTOP, "home-active-desktop-1440x900.png"));
test("active tablet 1024x768", async ({ page }) => shot(page, "/?scenario=active", TABLET, "home-active-tablet-1024x768.png"));
test("active mobile 390x844", async ({ page }) => shot(page, "/?scenario=active", MOBILE, "home-active-mobile-390x844.png"));
test("checkpoint desktop 1440x900", async ({ page }) => shot(page, "/?scenario=checkpoint", DESKTOP, "home-checkpoint-desktop-1440x900.png"));
test("checkpoint tablet 1024x768", async ({ page }) => shot(page, "/?scenario=checkpoint", TABLET, "home-checkpoint-tablet-1024x768.png"));
test("checkpoint mobile 390x844", async ({ page }) => shot(page, "/?scenario=checkpoint", MOBILE, "home-checkpoint-mobile-390x844.png"));

test("active zoom 200% (viewport 1440x900, zoom 2 ≈ 720x450 CSS)", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/?scenario=active", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    (document.documentElement.style as unknown as { zoom: string }).zoom = "2";
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "home-active-zoom-200.png"), clip: { x: 0, y: 0, ...DESKTOP } });
});

test("active mobile 320 (viewport 320x720)", async ({ page }) =>
  shot(page, "/?scenario=active", { width: 320, height: 720 }, "home-active-mobile-320.png"));
