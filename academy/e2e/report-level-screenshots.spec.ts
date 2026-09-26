import { test, type Page } from "@playwright/test";
import { screenshotDir } from "./support/artifact-paths";

/**
 * D3-B — report level artifact capture.
 *
 * Named *-screenshots.spec.ts, NOT *-smoke.spec.ts: per DD-257 this file writes
 * PNGs to the gitignored test-results artifact directory and is therefore deliberately excluded from the standard
 * `npm run test:e2e` gate. Re-running a screenshot spec overwrites historical
 * evidence, so it is run by hand:
 *
 *   npx playwright test e2e/report-level-screenshots.spec.ts
 *
 * It writes only under the gitignored test-results/screenshots/d3-report/final/ and never
 * touches the D3-A concept frames.
 *
 * `?scenario=report` is the development/test marker adapter (DD-271) — the only
 * marker under which the report is live work.
 */

const OUT = screenshotDir("d3-report/final");

const REPORT = "/lessons/level.003?scenario=report";
const LIB = "/lessons?scenario=report";
const PATH = "/path?scenario=report";

const SAVE_SETTLE = 900;

const openRow = (page: Page, ordinal: number) =>
  page.getByRole("button", { name: new RegExp(`^Запись ${ordinal}:`) });

const noticedField = (page: Page) => page.getByLabel(/Что заметил после сделки/);
const summaryField = (page: Page) => page.getByRole("textbox", { name: "Итоговое наблюдение" });
const submitButton = (page: Page) => page.getByRole("button", { name: "Отправить на проверку" });

/** Deterministic prototype-only copy — no trading advice, no financial claims. */
const OBSERVATIONS = [
  "Дождался условия входа, которое записал заранее, и вошёл спокойно.",
  "Условие не выполнилось, и я отказался от входа. Отказ дался легче, чем ожидал.",
  "Вошёл раньше, чем собирался: условие ещё не выполнилось, но я торопился.",
  "Снова дождался условия. Заметил, что решение занимает меньше времени.",
  "Закрыл раньше плана, потому что стало тревожно, а не потому что менялись условия.",
];

const SUMMARY =
  "Записанное заранее условие — единственное, что отличало обдуманные входы от случайных.";

/**
 * Entry navigation, whichever viewport we are on.
 *
 * Desktop exposes a collapsed row per entry; mobile hides them (they leave the
 * a11y tree entirely) and navigates with «Предыдущая/Следующая запись». A helper
 * that only knew about rows silently filled entry 1 five times on mobile and
 * produced evidence claiming more was filled than actually was.
 */

/** Which entry is currently open, read from the page rather than assumed. */
async function currentOpenOrdinal(page: Page): Promise<number | null> {
  for (let i = 1; i <= 5; i += 1) {
    if ((await page.getByRole("heading", { level: 3, name: `Запись ${i}` }).count()) > 0) return i;
  }
  return null;
}

async function openEntry(page: Page, ordinal: number) {
  const row = openRow(page, ordinal);
  if ((await row.count()) > 0) {
    await row.click();
    return;
  }
  // Mobile: step TOWARDS the wanted entry. A forward-only walk cannot come back
  // from entry 2 to entry 1, and silently ran into the disabled end button.
  for (let guard = 0; guard < 8; guard += 1) {
    const current = await currentOpenOrdinal(page);
    if (current === null || current === ordinal) return;
    const label = current < ordinal ? /Следующая запись/ : /Предыдущая запись/;
    await page.getByRole("button", { name: label }).click();
  }
}

async function fillEntries(page: Page, count: number) {
  for (let i = 1; i <= count; i += 1) {
    if (i > 1) await openEntry(page, i);
    await noticedField(page).fill(OBSERVATIONS[i - 1]!);
  }
}

async function makeReady(page: Page) {
  await fillEntries(page, 5);
  await summaryField(page).fill(SUMMARY);
  await page.waitForTimeout(SAVE_SETTLE);
}

async function submit(page: Page) {
  await makeReady(page);
  await submitButton(page).click();
  await page.getByRole("button", { name: "Отметить как отправленный" }).click();
  await page.waitForTimeout(200);
}

/**
 * Fonts must be resolved before the shutter or the type rhythm is not the real
 * one — and the page must be scrolled home: filling the ledger scrolls, and a
 * clip taken from a scrolled page cut the app shell out of the evidence.
 */
async function shoot(page: Page, name: string, size: { width: number; height: number }) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({
    path: `${OUT}/${name}`,
    clip: { x: 0, y: 0, width: size.width, height: size.height },
  });
}

const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 1024, height: 768 };
const MOBILE = { width: 390, height: 844 };
const NARROW = { width: 320, height: 720 };
/** The real layout viewport at 200% zoom of a 1440x900 window. */
const ZOOM_200 = { width: 720, height: 450 };
const SHORT = { width: 1440, height: 650 };

test.describe("D3-B report level — final evidence", () => {
  test("empty draft — desktop", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await shoot(page, "report-empty-desktop-1440x900.png", DESKTOP);
  });

  test("partial draft — desktop", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await fillEntries(page, 3);
    await page.waitForTimeout(SAVE_SETTLE);
    await shoot(page, "report-partial-desktop-1440x900.png", DESKTOP);
  });

  test("ready — desktop", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await makeReady(page);
    await shoot(page, "report-ready-desktop-1440x900.png", DESKTOP);
  });

  test("submit confirmation — desktop", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await makeReady(page);
    await submitButton(page).click();
    await page.getByRole("dialog").waitFor();
    await shoot(page, "report-submit-confirmation-desktop.png", DESKTOP);
  });

  test("pending review — desktop", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await submit(page);
    await shoot(page, "report-pending-desktop-1440x900.png", DESKTOP);
  });

  test("lessons library with a pending report — desktop", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await submit(page);
    await page.goto(LIB);
    await shoot(page, "report-library-pending-desktop.png", DESKTOP);
  });

  test("path with a pending report — desktop", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(REPORT);
    await submit(page);
    await page.goto(PATH);
    await page.getByRole("button", { name: /Уровень 3/ }).first().click();
    await page.waitForTimeout(300);
    await shoot(page, "report-path-pending-desktop.png", DESKTOP);
  });

  test("tablet", async ({ page }) => {
    await page.setViewportSize(TABLET);
    await page.goto(REPORT);
    await fillEntries(page, 3);
    await page.waitForTimeout(SAVE_SETTLE);
    await shoot(page, "report-tablet-1024x768.png", TABLET);
  });

  test("mobile — one entry at a time", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(REPORT);
    await fillEntries(page, 3);
    await page.waitForTimeout(SAVE_SETTLE);
    await shoot(page, "report-mobile-390x844.png", MOBILE);
  });

  test("mobile — pending review", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(REPORT);
    await submit(page);
    await shoot(page, "report-mobile-pending-390x844.png", MOBILE);
  });

  test("mobile 320", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await page.goto(REPORT);
    await fillEntries(page, 2);
    await page.waitForTimeout(SAVE_SETTLE);
    await shoot(page, "report-mobile-320x720.png", NARROW);
  });

  test("200% zoom", async ({ page }) => {
    await page.setViewportSize(ZOOM_200);
    await page.goto(REPORT);
    await fillEntries(page, 2);
    await page.waitForTimeout(SAVE_SETTLE);
    await shoot(page, "report-zoom-200.png", ZOOM_200);
  });

  test("short viewport", async ({ page }) => {
    await page.setViewportSize(SHORT);
    await page.goto(REPORT);
    await fillEntries(page, 3);
    await page.waitForTimeout(SAVE_SETTLE);
    await shoot(page, "report-short-viewport.png", SHORT);
  });
});
