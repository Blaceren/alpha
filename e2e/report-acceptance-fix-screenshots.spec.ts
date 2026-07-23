import { test, type Page } from "@playwright/test";
import { screenshotDir } from "./support/artifact-paths";

/**
 * D3-B.1 — mobile safe-area acceptance evidence.
 *
 * Named *-screenshots.spec.ts, so per DD-257 the standard `npm run test:e2e`
 * gate excludes it: it writes PNGs. Run by hand:
 *
 *   npx playwright test e2e/report-acceptance-fix-screenshots.spec.ts
 *
 * It writes ONLY under the gitignored test-results/screenshots/d3-report/mobile-acceptance-fix/
 * and never touches the 13 historical D3-B frames in .../final/ or the D3-A
 * concept frames.
 *
 * Every frame is taken at the BOTTOM of the page, so the last control, the top
 * edge of the bottom navigation and the real gap between them are all visible in
 * one shot — the claim and its evidence in the same image.
 */

const OUT = screenshotDir("d3-report/mobile-acceptance-fix");
const REPORT = "/lessons/level.003?scenario=report";
const SAVE_SETTLE = 900;

const openRow = (page: Page, ordinal: number) =>
  page.getByRole("button", { name: new RegExp(`^Запись ${ordinal}:`) });
const noticedField = (page: Page) => page.getByLabel(/Что заметил после сделки/);
const summaryField = (page: Page) => page.getByRole("textbox", { name: "Итоговое наблюдение" });
const submitButton = (page: Page) => page.getByRole("button", { name: "Отправить на проверку" });

const OBSERVATIONS = [
  "Дождался условия входа, которое записал заранее, и вошёл спокойно.",
  "Условие не выполнилось, и я отказался от входа.",
  "Вошёл раньше, чем собирался: условие ещё не выполнилось.",
  "Снова дождался условия. Решение заняло меньше времени.",
  "Закрыл раньше плана, потому что стало тревожно.",
];

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
  await summaryField(page).fill("Записанное заранее условие отличало обдуманные входы от случайных.");
  await page.waitForTimeout(SAVE_SETTLE);
}

/** Shoot the BOTTOM of the page — that is where the claim lives. */
async function shootBottom(page: Page, name: string, size: { width: number; height: number }) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({
    path: `${OUT}/${name}`,
    clip: { x: 0, y: 0, width: size.width, height: size.height },
  });
}

const MOBILE = { width: 390, height: 844 };
const NARROW = { width: 320, height: 720 };
const ZOOM_200 = { width: 720, height: 450 };

test.describe("D3-B.1 — mobile safe area evidence", () => {
  test("partial draft — 390", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(REPORT);
    await fillEntries(page, 3);
    await page.waitForTimeout(SAVE_SETTLE);
    await shootBottom(page, "report-mobile-partial-bottom-390x844.png", MOBILE);
  });

  test("ready — 390", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(REPORT);
    await makeReady(page);
    await shootBottom(page, "report-mobile-ready-bottom-390x844.png", MOBILE);
  });

  test("pending review — 390", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(REPORT);
    await makeReady(page);
    await submitButton(page).click();
    await page.getByRole("button", { name: "Отметить как отправленный" }).click();
    await page.waitForTimeout(300);
    await shootBottom(page, "report-mobile-pending-bottom-390x844.png", MOBILE);
  });

  test("partial draft — 320", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await page.goto(REPORT);
    await fillEntries(page, 2);
    await page.waitForTimeout(SAVE_SETTLE);
    await shootBottom(page, "report-mobile-partial-bottom-320x720.png", NARROW);
  });

  test("200% zoom", async ({ page }) => {
    await page.setViewportSize(ZOOM_200);
    await page.goto(REPORT);
    await fillEntries(page, 3);
    await page.waitForTimeout(SAVE_SETTLE);
    await shootBottom(page, "report-mobile-zoom-bottom-720x450.png", ZOOM_200);
  });
});
