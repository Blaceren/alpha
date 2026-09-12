import { test, type Page } from "@playwright/test";
import { screenshotDir } from "./support/artifact-paths";
import fs from "node:fs";
import path from "node:path";

/**
 * D2C-B lessons-library screenshots. Output via SHOT_OUT (first-pass | final).
 *
 * ARTIFACT CAPTURE, not behavioral regression: named *-screenshots.spec.ts so the
 * standard `npm run test:e2e` gate excludes it (DD-257). It writes PNGs, and
 * re-running a past phase's screenshot spec would overwrite historical evidence —
 * which is exactly why the two layers are split.
 */
const OUT = screenshotDir("d2c-lessons-library", process.env.SHOT_OUT ?? "final");
fs.mkdirSync(OUT, { recursive: true });

const LIB = "/lessons";
const L18 = "/lessons/level.018";

const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 1024, height: 768 };
const MOBILE = { width: 390, height: 844 };
const MOBILE_320 = { width: 320, height: 720 };
/** 200% zoom halves the CSS layout viewport of a 1440x900 window (real reflow). */
const ZOOM_200 = { width: 720, height: 450 };
const SHORT = { width: 1440, height: 650 };

const CORRECT = [
  "Область графика, где цена ранее неоднократно встречала спрос и переставала снижаться.",
  "Реакции происходят в диапазоне цен, а точные касания одного и того же значения встречаются редко.",
  "О том, что область заметна многим участникам, поэтому вывод опирается не на один случай.",
  "Это наблюдение, которому нужно подтверждение реакцией цены; сам подход к области ничего не решает.",
];

test.use({ deviceScaleFactor: 1 });

async function open(page: Page, url: string, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.goto(url, { waitUntil: "networkidle" });
  // Variable fonts must be resolved before the shutter, or the type rhythm in the
  // evidence is not the type rhythm of the page.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(350);
}

function grab(page: Page, size: { width: number; height: number }, file: string) {
  return page.screenshot({
    path: path.join(OUT, file),
    clip: { x: 0, y: 0, width: size.width, height: size.height },
  });
}

/** Finish level 18 for real, so the "after completion" frame is a real state. */
async function completeLevel18(page: Page) {
  await page.clock.install();
  await page.goto(L18, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Смотреть" }).click();
  await page.clock.runFor(245_000);
  await page.getByRole("button", { name: "Пауза" }).click();
  await page.getByRole("button", { name: /Начать проверку/ }).click();
  for (let i = 0; i < CORRECT.length; i += 1) {
    await page.getByRole("radio", { name: CORRECT[i]! }).check();
    await page.getByRole("button", { name: "Ответить" }).click();
    if (i < CORRECT.length - 1) {
      await page.getByRole("button", { name: /Следующий вопрос/ }).click();
    }
  }
}

test("library — desktop, module selected, tablet, short", async ({ page }) => {
  await open(page, LIB, DESKTOP);
  await grab(page, DESKTOP, "lessons-library-desktop-1440x900.png");

  await open(page, `${LIB}?module=module.09`, DESKTOP);
  await grab(page, DESKTOP, "lessons-library-module-selected-desktop.png");

  await open(page, LIB, TABLET);
  await grab(page, TABLET, "lessons-library-tablet-1024x768.png");

  await open(page, LIB, SHORT);
  await grab(page, SHORT, "lessons-library-short-viewport.png");
});

test("library — after real completion of level 18", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await completeLevel18(page);
  await open(page, LIB, DESKTOP);
  await grab(page, DESKTOP, "lessons-library-after-completion-desktop.png");
});

test("library — mobile, modules sheet, 320, zoom", async ({ page }) => {
  await open(page, LIB, MOBILE);
  await grab(page, MOBILE, "lessons-library-mobile-390x844.png");

  await page.getByRole("button", { name: /Открыть список всех модулей/ }).click();
  await page.waitForTimeout(250);
  await grab(page, MOBILE, "lessons-library-mobile-modules-open.png");

  await open(page, LIB, MOBILE_320);
  await grab(page, MOBILE_320, "lessons-library-mobile-320x720.png");

  await open(page, LIB, ZOOM_200);
  await grab(page, ZOOM_200, "lessons-library-zoom-200.png");
});
