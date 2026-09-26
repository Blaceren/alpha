import { test, type Page } from "@playwright/test";
import { screenshotDir } from "./support/artifact-paths";
import fs from "node:fs";
import path from "node:path";

/** Phase D2A-R1 — path correction evidence. SHOT_OUT = first-pass | final. */
const OUT = screenshotDir("d2a-r1-path-correction", process.env.SHOT_OUT ?? "final");
fs.mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 1024, height: 768 };
const MOBILE = { width: 390, height: 844 };
const MOBILE_320 = { width: 320, height: 720 };
const LANDSCAPE = { width: 844, height: 390 };
const ZOOM_200 = { width: 720, height: 450 };

test.use({ deviceScaleFactor: 1 });

async function open(page: Page, url: string, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(420);
}
function grab(page: Page, size: { width: number; height: number }, file: string) {
  return page.screenshot({ path: path.join(OUT, file), clip: { x: 0, y: 0, ...size } });
}

test("active desktop", async ({ page }) => {
  await open(page, "/path?scenario=active", DESKTOP);
  await grab(page, DESKTOP, "path-active-desktop-1440x900.png");
});
test("active tablet", async ({ page }) => {
  await open(page, "/path?scenario=active", TABLET);
  await grab(page, TABLET, "path-active-tablet-1024x768.png");
});
test("active mobile 390", async ({ page }) => {
  await open(page, "/path?scenario=active", MOBILE);
  await grab(page, MOBILE, "path-active-mobile-390x844.png");
});
test("active mobile 320", async ({ page }) => {
  await open(page, "/path?scenario=active", MOBILE_320);
  await grab(page, MOBILE_320, "path-active-mobile-320x720.png");
});
test("mobile landscape", async ({ page }) => {
  await open(page, "/path?scenario=active", LANDSCAPE);
  await grab(page, LANDSCAPE, "path-mobile-landscape-844x390.png");
});
test("zoom 200 (reflow 720x450)", async ({ page }) => {
  await open(page, "/path?scenario=active", ZOOM_200);
  await grab(page, ZOOM_200, "path-zoom-200.png");
});
test("level detail desktop", async ({ page }) => {
  await open(page, "/path?scenario=active", DESKTOP);
  await page.locator('.pnode[data-level="18"]').click();
  await page.waitForTimeout(350);
  await grab(page, DESKTOP, "path-level-detail-desktop.png");
});
test("level detail mobile", async ({ page }) => {
  await open(page, "/path?scenario=active", MOBILE);
  await page.locator('.pnode[data-level="18"]').click();
  await page.waitForTimeout(350);
  await grab(page, MOBILE, "path-level-detail-mobile.png");
});
test("module navigator (completed module viewed)", async ({ page }) => {
  await open(page, "/path?scenario=active", DESKTOP);
  await page
    .getByRole("navigation", { name: "Модули пути" })
    .getByRole("button", { name: /Модуль 1 «Первое знакомство»/ })
    .click();
  await page.waitForTimeout(350);
  await grab(page, DESKTOP, "path-module-navigator-desktop.png");
});
test("future module desktop", async ({ page }) => {
  await open(page, "/path?scenario=active", DESKTOP);
  await page
    .getByRole("navigation", { name: "Модули пути" })
    .getByRole("button", { name: /Модуль 12 «Исполнение»/ })
    .click();
  await page.waitForTimeout(350);
  await grab(page, DESKTOP, "path-future-module-desktop.png");
});
test("checkpoint mobile", async ({ page }) => {
  await open(page, "/path?scenario=checkpoint", MOBILE);
  await grab(page, MOBILE, "path-checkpoint-mobile-390x844.png");
});
