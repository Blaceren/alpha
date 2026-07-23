import { test, type Page } from "@playwright/test";
import { screenshotDir } from "./support/artifact-paths";

/**
 * D3-C — report revision cycle artifact capture.
 *
 * Named *-screenshots.spec.ts, NOT *-smoke.spec.ts: per DD-257 this file writes
 * PNGs to the gitignored test-results artifact directory and is therefore deliberately excluded from the standard
 * `npm run test:e2e` gate. Re-running a screenshot spec overwrites evidence, so
 * it is run by hand, staged:
 *
 *   npx playwright test e2e/report-revision-screenshots.spec.ts
 *   REVISION_SHOTS_STAGE=final npx playwright test e2e/report-revision-screenshots.spec.ts
 *
 * It writes ONLY under the gitignored test-results/screenshots/d3-revision/<stage>/ and never
 * touches d3-report/** or d3-revision/concepts/** (the historical evidence).
 *
 * `?scenario=report` is the development/test marker adapter (DD-272); the
 * revision state is seeded directly as the v2 record the verdict adapter would
 * leave (DD-286) — deterministic frames, no UI walking to set up state.
 */

const STAGE = process.env.REVISION_SHOTS_STAGE === "final" ? "final" : "first-pass";
const OUT = screenshotDir("d3-revision", STAGE);

const REPORT = "/lessons/level.003?scenario=report";
const LIB = "/lessons?scenario=report";
const PATH = "/path?scenario=report";

const KEY_V2 = "ata.report-workspace.v2";
const SAVE_SETTLE = 900;

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const MOBILE_320 = { width: 320, height: 720 };
const ZOOM_200 = { width: 720, height: 450 };
const SHORT = { width: 1440, height: 650 };

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

const EDIT_NOTICED =
  "Вошёл раньше, чем собирался: условие ещё не выполнилось, но я торопился. До входа было записано условие «дождаться подтверждения», и я отметил, что нарушил его.";

const seedPayload = {
  version: 2,
  reports: [
    {
      levelCode: "level.003",
      entries: OBSERVATIONS.map((noticed, index) => ({
        id: `report.003.entry.${index + 1}`,
        ordinal: index + 1,
        when: "",
        decided: "",
        noticed,
      })),
      summary: SUMMARY,
      status: "revision-requested",
      submittedAt: "2026-07-17T10:00:00.000Z",
      revision: 6,
      meaningfulRevision: 6,
      review: {
        comment:
          "Уточните, какое условие было записано до входа, и свяжите итоговое наблюдение со всеми пятью записями.",
        sections: ["report.003.entry.3.noticed", "report.003.summary"],
        receivedAt: "2026-07-18T09:00:00.000Z",
        atRevision: 6,
      },
    },
  ],
};

/** Seed once per context; never re-seed over what the UI already changed. */
async function seed(page: Page) {
  await page.addInitScript(
    ([key, value]) => {
      if (window.localStorage.getItem(key!) === null) {
        window.localStorage.setItem(key!, value!);
      }
    },
    [KEY_V2, JSON.stringify(seedPayload)],
  );
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

async function shot(page: Page, name: string) {
  const { width, height } = page.viewportSize()!;
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: { x: 0, y: 0, width, height } });
}

const noticedField = (page: Page) => page.getByLabel("Что заметил после сделки");
const resubmitButton = (page: Page) =>
  page.getByRole("button", { name: "Отправить на проверку повторно" });
const jumpToSummary = (page: Page) =>
  page.getByRole("button", { name: "Итоговое наблюдение", exact: true });

/* ------------------------------------------------------------------ *
 * Desktop 1440×900
 * ------------------------------------------------------------------ */

test("revision-requested — desktop", async ({ page }) => {
  await seed(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(REPORT);
  await settle(page);
  await shot(page, "report-revision-requested-desktop-1440x900");
});

test("target: flagged entry focused — desktop", async ({ page }) => {
  await seed(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(REPORT);
  await settle(page);
  await page
    .getByRole("button", { name: "Запись 03 · Что заметил после сделки" })
    .click();
  await page.waitForTimeout(250);
  await shot(page, "report-revision-target-entry-desktop-1440x900");
});

test("target: flagged summary focused — desktop", async ({ page }) => {
  await seed(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(REPORT);
  await settle(page);
  await jumpToSummary(page).click();
  await page.waitForTimeout(250);
  await shot(page, "report-revision-target-summary-desktop-1440x900");
});

test("ready-to-resubmit — desktop", async ({ page }) => {
  await seed(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(REPORT);
  await settle(page);
  await noticedField(page).fill(EDIT_NOTICED);
  await page.waitForTimeout(SAVE_SETTLE);
  await resubmitButton(page).scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await shot(page, "report-ready-to-resubmit-desktop-1440x900");
});

test("resubmit confirmation — desktop", async ({ page }) => {
  await seed(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(REPORT);
  await settle(page);
  await noticedField(page).fill(EDIT_NOTICED);
  await page.waitForTimeout(SAVE_SETTLE);
  await resubmitButton(page).click();
  await page.waitForTimeout(250);
  await shot(page, "report-resubmit-confirmation-desktop-1440x900");
});

test("pending after resubmit — desktop", async ({ page }) => {
  await seed(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(REPORT);
  await settle(page);
  await noticedField(page).fill(EDIT_NOTICED);
  await page.waitForTimeout(SAVE_SETTLE);
  await resubmitButton(page).click();
  await page.getByRole("dialog").getByRole("button", { name: "Отправить повторно" }).click();
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  await shot(page, "report-pending-after-resubmit-desktop-1440x900");
});

test("lessons library with revision status — desktop", async ({ page }) => {
  await seed(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(LIB);
  await settle(page);
  await shot(page, "lessons-library-revision-desktop-1440x900");
});

test("path with revision status — desktop", async ({ page }) => {
  await seed(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(PATH);
  await settle(page);
  await page.getByRole("button", { name: /Уровень 3/ }).click();
  await page.waitForTimeout(300);
  await shot(page, "path-revision-desktop-1440x900");
});

/* ------------------------------------------------------------------ *
 * Mobile / zoom / short viewport
 * ------------------------------------------------------------------ */

test("revision-requested — mobile 390", async ({ page }) => {
  await seed(page);
  await page.setViewportSize(MOBILE);
  await page.goto(REPORT);
  await settle(page);
  await shot(page, "report-revision-mobile-390x844");
});

test("target summary — mobile 390", async ({ page }) => {
  await seed(page);
  await page.setViewportSize(MOBILE);
  await page.goto(REPORT);
  await settle(page);
  await jumpToSummary(page).click();
  await page.waitForTimeout(300);
  await shot(page, "report-revision-mobile-target-summary-390x844");
});

test("ready-to-resubmit — mobile 390", async ({ page }) => {
  await seed(page);
  await page.setViewportSize(MOBILE);
  await page.goto(REPORT);
  await settle(page);
  await noticedField(page).fill(EDIT_NOTICED);
  await page.waitForTimeout(SAVE_SETTLE);
  await resubmitButton(page).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 120));
  await page.waitForTimeout(250);
  await shot(page, "report-ready-mobile-390x844");
});

test("revision-requested — mobile 320", async ({ page }) => {
  await seed(page);
  await page.setViewportSize(MOBILE_320);
  await page.goto(REPORT);
  await settle(page);
  await shot(page, "report-revision-mobile-320x720");
});

test("revision-requested — 200% zoom", async ({ page }) => {
  await seed(page);
  await page.setViewportSize(ZOOM_200);
  await page.goto(REPORT);
  await settle(page);
  await shot(page, "report-revision-zoom-200");
});

test("revision-requested — short viewport 1440×650", async ({ page }) => {
  await seed(page);
  await page.setViewportSize(SHORT);
  await page.goto(REPORT);
  await settle(page);
  await shot(page, "report-revision-short-1440x650");
});
