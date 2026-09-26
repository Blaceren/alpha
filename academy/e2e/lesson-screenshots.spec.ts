import { test, type Page } from "@playwright/test";
import { screenshotDir } from "./support/artifact-paths";
import fs from "node:fs";
import path from "node:path";

/** Output dir chosen via SHOT_OUT (first-pass | final). Phase D2B. */
const OUT = screenshotDir("d2b-lesson", process.env.SHOT_OUT ?? "final");
fs.mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 1024, height: 768 };
const MOBILE = { width: 390, height: 844 };
const MOBILE_320 = { width: 320, height: 720 };
const LANDSCAPE = { width: 844, height: 390 };
/** 200% zoom halves the CSS layout viewport of a 1440x900 window (real reflow). */
const ZOOM_200 = { width: 720, height: 450 };

const L18 = "/lessons/level.018";
const L19 = "/lessons/level.019";

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

/** Scroll so the assessment stage is in view, then capture the viewport. */
async function shotAt(
  page: Page,
  url: string,
  size: { width: number; height: number },
  selector: string,
  file: string,
) {
  await page.setViewportSize(size);
  await page.goto(url, { waitUntil: "networkidle" });
  await settle(page);
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, file), clip: { x: 0, y: 0, ...size } });
}

test("lesson — desktop states", async ({ page }) => {
  await shot(page, `${L18}?scenario=initial`, DESKTOP, "lesson-initial-desktop-1440x900.png");
  await shot(page, `${L18}?scenario=watching`, DESKTOP, "lesson-watching-desktop-1440x900.png");
  await shot(page, `${L18}?scenario=threshold-49`, DESKTOP, "lesson-test-locked-49-desktop.png");
  await shot(page, `${L18}?scenario=threshold-50`, DESKTOP, "lesson-test-unlocked-50-desktop.png");
  await shotAt(page, `${L18}?scenario=testing`, DESKTOP, ".la", "lesson-question-desktop.png");
  await shotAt(page, `${L18}?scenario=incorrect`, DESKTOP, ".la", "lesson-feedback-incorrect-desktop.png");
  await shot(page, `${L18}?scenario=completed`, DESKTOP, "lesson-completed-desktop.png");
  await shot(page, `${L19}?scenario=locked`, DESKTOP, "lesson-locked-level-19-desktop.png");
});

test("lesson — correct feedback desktop", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(`${L18}?scenario=testing`, { waitUntil: "networkidle" });
  await settle(page);
  // answer the open question correctly, then capture the explanation
  await page.getByRole("radio").nth(1).check();
  await page.getByRole("button", { name: "Ответить" }).click();
  await page.locator(".lfb.ok").waitFor();
  await page.locator(".la").scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(OUT, "lesson-feedback-correct-desktop.png"),
    clip: { x: 0, y: 0, ...DESKTOP },
  });
});

test("lesson — tablet, mobile, narrow, landscape, zoom", async ({ page }) => {
  await shot(page, `${L18}?scenario=threshold-50`, TABLET, "lesson-tablet-1024x768.png");
  await shot(page, `${L18}?scenario=initial`, MOBILE, "lesson-mobile-390x844.png");
  await shotAt(page, `${L18}?scenario=testing`, MOBILE, ".la", "lesson-mobile-question-390x844.png");
  await shotAt(page, `${L18}?scenario=incorrect`, MOBILE, ".la", "lesson-mobile-feedback-390x844.png");
  await shotAt(page, `${L18}?scenario=completed`, MOBILE, ".lcp", "lesson-mobile-completed-390x844.png");
  await shot(page, `${L18}?scenario=threshold-49`, MOBILE_320, "lesson-mobile-320x720.png");
  await shot(page, `${L18}?scenario=threshold-50`, LANDSCAPE, "lesson-landscape-844x390.png");
  await shot(page, `${L18}?scenario=threshold-50`, ZOOM_200, "lesson-zoom-200.png");
});
