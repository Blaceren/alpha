import { test, type Page } from "@playwright/test";
import { screenshotDir } from "./support/artifact-paths";

/**
 * D3-D — approved report state artifact capture.
 *
 * Named *-screenshots.spec.ts, NOT *-smoke.spec.ts: per DD-257 this file writes
 * PNGs to the gitignored test-results artifact directory and is deliberately excluded from `npm run test:e2e`.
 * Run by hand, staged:
 *
 *   npx playwright test e2e/report-approved-screenshots.spec.ts
 *   APPROVED_SHOTS_STAGE=final npx playwright test e2e/report-approved-screenshots.spec.ts
 *
 * Writes ONLY under the gitignored test-results/screenshots/d3-approved/<stage>/ and never
 * touches other historical evidence.
 *
 * The approved state is seeded directly as the v3 record the verdict adapter
 * would leave (DD-298) — deterministic frames, no UI walking. The 200% frame
 * uses a REAL reflow (a 720×450 CSS viewport), never documentElement.style.zoom.
 */

const STAGE = process.env.APPROVED_SHOTS_STAGE === "final" ? "final" : "first-pass";
const OUT = screenshotDir("d3-approved", STAGE);

const REPORT = "/lessons/level.003?scenario=report";
const REPORT_CANONICAL = "/lessons/level.003";
const REPORT_APPROVE = "/lessons/level.003?scenario=report&verdict=approved";
const LIB = "/lessons?scenario=report";
const PATH = "/path?scenario=report";

const KEY_V3 = "ata.report-workspace.v3";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const MOBILE_320 = { width: 320, height: 720 };
const ZOOM_200 = { width: 720, height: 450 };
const SHORT = { width: 1440, height: 650 };

const OBSERVATIONS = [
  "Дождался условия входа, которое записал заранее, и вошёл спокойно.",
  "Условие не выполнилось, и я отказался от входа. Отказ дался легче, чем ожидал.",
  "Вошёл раньше, чем собирался: условие ещё не выполнилось, но я торопился.",
  "Снова дождался условия. Заметил, что решение занимает меньше времени.",
  "Закрыл раньше плана, потому что стало тревожно, а не потому что менялись условия.",
];
const SUMMARY =
  "Записанное заранее условие — единственное, что отличало обдуманные входы от случайных.";
const REVIEW = {
  comment:
    "Уточните, какое условие было записано до входа, и свяжите итоговое наблюдение со всеми пятью записями.",
  sections: ["report.003.entry.3.noticed"],
  receivedAt: "2026-07-18T09:00:00.000Z",
  atRevision: 6,
};

function record(status: string, extra: Record<string, unknown> = {}) {
  return {
    version: 3,
    reports: [
      {
        levelCode: "level.003",
        entries: OBSERVATIONS.map((noticed, i) => ({
          id: `report.003.entry.${i + 1}`,
          ordinal: i + 1,
          when: "",
          decided: "",
          noticed,
        })),
        summary: SUMMARY,
        status,
        submittedAt: "2026-07-17T10:00:00.000Z",
        revision: 7,
        meaningfulRevision: 7,
        review: null,
        approvedAt: status === "approved" ? "2026-07-18T12:00:00.000Z" : null,
        ...extra,
      },
    ],
  };
}

async function seed(page: Page, payload: object) {
  await page.addInitScript(
    ([key, value]) => {
      if (window.localStorage.getItem(key!) === null) {
        window.localStorage.setItem(key!, value!);
      }
    },
    [KEY_V3, JSON.stringify(payload)],
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

/* ------------------------------------------------------------------ *
 * 1–2 — the approved report, desktop
 * ------------------------------------------------------------------ */

test("approved — desktop", async ({ page }) => {
  await seed(page, record("approved"));
  await page.setViewportSize(DESKTOP);
  await page.goto(REPORT);
  await settle(page);
  await shot(page, "report-approved-desktop-1440x900");
});

test("approved with history — desktop", async ({ page }) => {
  await seed(page, record("approved", { review: REVIEW }));
  await page.setViewportSize(DESKTOP);
  await page.goto(REPORT);
  await settle(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(150);
  await shot(page, "report-approved-with-history-desktop-1440x900");
});

/* ------------------------------------------------------------------ *
 * 3–4 — surfaces
 * ------------------------------------------------------------------ */

test("lessons library after approval — desktop", async ({ page }) => {
  await seed(page, record("approved"));
  await page.setViewportSize(DESKTOP);
  await page.goto(LIB);
  await settle(page);
  await shot(page, "lessons-library-approved-desktop-1440x900");
});

test("path after approval — desktop", async ({ page }) => {
  await seed(page, record("approved"));
  await page.setViewportSize(DESKTOP);
  await page.goto(PATH);
  await settle(page);
  await page.getByRole("button", { name: /Уровень 4/ }).first().click();
  await page.waitForTimeout(300);
  await shot(page, "path-approved-desktop-1440x900");
});

/* ------------------------------------------------------------------ *
 * 5–8 — responsive
 * ------------------------------------------------------------------ */

test("approved — mobile 390x844", async ({ page }) => {
  await seed(page, record("approved"));
  await page.setViewportSize(MOBILE);
  await page.goto(REPORT);
  await settle(page);
  await shot(page, "report-approved-mobile-390x844");
});

test("approved — mobile 320x720", async ({ page }) => {
  await seed(page, record("approved"));
  await page.setViewportSize(MOBILE_320);
  await page.goto(REPORT);
  await settle(page);
  await shot(page, "report-approved-mobile-320x720");
});

test("approved — zoom 200% (720x450 real reflow)", async ({ page }) => {
  await seed(page, record("approved"));
  await page.setViewportSize(ZOOM_200);
  await page.goto(REPORT);
  await settle(page);
  await shot(page, "report-approved-zoom-200-720x450");
});

test("approved — short 1440x650", async ({ page }) => {
  await seed(page, record("approved"));
  await page.setViewportSize(SHORT);
  await page.goto(REPORT);
  await settle(page);
  await shot(page, "report-approved-short-1440x650");
});

/* ------------------------------------------------------------------ *
 * 9–10 — canonical L18 and storage failure
 * ------------------------------------------------------------------ */

test("approved stored, canonical L18 — desktop", async ({ page }) => {
  await seed(page, record("approved"));
  await page.setViewportSize(DESKTOP);
  await page.goto(REPORT_CANONICAL);
  await settle(page);
  await shot(page, "report-approved-canonical-l18-desktop-1440x900");
});

test("approval storage failure stays pending — desktop", async ({ page }) => {
  await seed(page, record("pending-review"));
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    let armed = false;
    queueMicrotask(() => {
      armed = true;
    });
    Storage.prototype.setItem = function (key: string, value: string) {
      if (armed && key === "ata.report-workspace.v3") throw new Error("QuotaExceeded");
      return original.call(this, key, value);
    };
  });
  await page.setViewportSize(DESKTOP);
  await page.goto(REPORT_APPROVE);
  await settle(page);
  await shot(page, "report-approved-storage-failure-desktop-1440x900");
});
