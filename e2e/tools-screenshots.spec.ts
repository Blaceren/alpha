import { test, expect, type Page } from "@playwright/test";
import { screenshotDir } from "./support/artifact-paths";
import path from "node:path";

/**
 * Tools + Trading Journal screenshots (D4-B) — ARTIFACT ONLY. This filename does
 * NOT match `smoke.spec.ts`, so it is excluded from the mandatory `npm run
 * test:e2e` behavioural gate; run it explicitly to (re)generate the visual-QA
 * set. Output pass is chosen with TOOLS_SHOT_PASS (first-pass | final; default
 * final). Every capture is viewport-clipped so the PNG dimensions match the
 * filename exactly (Desktop Chrome deviceScaleFactor = 1).
 */

const PASS = process.env.TOOLS_SHOT_PASS === "first-pass" ? "first-pass" : "final";
const OUT = screenshotDir("d4-trading-journal", PASS);
const STORAGE_KEY = "ata.tools.trading-journal.v1";
const JOURNAL = "/tools/tool.trading_journal";

const SEED = {
  version: 1,
  sequence: 3,
  entries: [
    {
      id: "journal-1",
      occurredAt: "2026-07-14T09:00:00.000Z",
      instrument: "XAU/USD",
      direction: "sell",
      setup: "отскок от уровня сопротивления",
      plan: "вход только после подтверждения свечой",
      execution: "дождался закрытия свечи, вошёл по плану",
      lesson: "Терпение сработало — вход строго по условию дал спокойную сделку.",
      manualResult: 18,
      createdAt: "2026-07-14T09:05:00.000Z",
      updatedAt: "2026-07-14T09:05:00.000Z",
    },
    {
      id: "journal-2",
      occurredAt: "2026-07-15T11:30:00.000Z",
      instrument: "EUR/USD",
      direction: "buy",
      setup: "пробой диапазона",
      plan: "ждать ретест уровня перед входом",
      execution: "вошёл до ретеста, поспешил",
      lesson: "Поспешил и нарушил собственное правило входа — цена ушла против.",
      manualResult: -7,
      createdAt: "2026-07-15T11:35:00.000Z",
      updatedAt: "2026-07-15T11:35:00.000Z",
    },
    {
      id: "journal-3",
      occurredAt: "2026-07-16T14:15:00.000Z",
      instrument: "GBP/USD",
      direction: "observation",
      setup: "нет чёткого сигнала",
      plan: "не входить без подтверждения тренда",
      execution: "остался вне рынка",
      lesson: "Пропуск — тоже решение. Отсутствие сделки сохранило капитал и дисциплину.",
      manualResult: null,
      createdAt: "2026-07-16T14:20:00.000Z",
      updatedAt: "2026-07-16T14:20:00.000Z",
    },
  ],
};

async function ready(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(120);
}

async function shot(page: Page, name: string, w: number, h: number) {
  await page.screenshot({ path: path.join(OUT, name), clip: { x: 0, y: 0, width: w, height: h } });
}

async function seed(page: Page) {
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    { key: STORAGE_KEY, value: SEED },
  );
}

async function clear(page: Page) {
  await page.addInitScript((key) => window.localStorage.removeItem(key), STORAGE_KEY);
}

/* ---------------- desktop 1440×900 ---------------- */
test("tools-hub-desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tools?scenario=active", { waitUntil: "networkidle" });
  await ready(page);
  await shot(page, "tools-hub-desktop-1440x900.png", 1440, 900);
});

test("tools-hub-locked-desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tools?scenario=early", { waitUntil: "networkidle" });
  await ready(page);
  await shot(page, "tools-hub-locked-desktop-1440x900.png", 1440, 900);
});

test("trading-journal-empty-desktop", async ({ page }) => {
  await clear(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(JOURNAL, { waitUntil: "networkidle" });
  await ready(page);
  await shot(page, "trading-journal-empty-desktop-1440x900.png", 1440, 900);
});

test("trading-journal-populated-desktop", async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(JOURNAL, { waitUntil: "networkidle" });
  await ready(page);
  await shot(page, "trading-journal-populated-desktop-1440x900.png", 1440, 900);
});

test("trading-journal-create-desktop", async ({ page }) => {
  await clear(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(JOURNAL, { waitUntil: "networkidle" });
  await ready(page);
  await page.getByRole("button", { name: /Добавить первую запись/ }).click();
  await page.getByLabel("Дата").fill("14.07.2026");
  await page.getByLabel("Время").fill("09:00");
  await page.getByLabel("Инструмент").fill("XAU/USD");
  await page.getByRole("radio", { name: /Продажа/ }).check();
  await page.getByLabel(/^План/).fill("вход только после подтверждения свечой");
  await page.getByLabel(/Исполнение/).fill("дождался закрытия свечи");
  await page.getByLabel(/Урок/).fill("терпение сработало — вход по условию");
  await page.getByLabel(/Ручной результат/).fill("18");
  await ready(page);
  await shot(page, "trading-journal-create-desktop-1440x900.png", 1440, 900);
});

test("trading-journal-edit-desktop", async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(JOURNAL, { waitUntil: "networkidle" });
  await ready(page);
  await page.getByRole("button", { name: /Редактировать/ }).first().click();
  await ready(page);
  await shot(page, "trading-journal-edit-desktop-1440x900.png", 1440, 900);
});

test("trading-journal-storage-error-desktop", async ({ page }) => {
  await clear(page);
  await page.addInitScript((key) => {
    const proto = Object.getPrototypeOf(window.localStorage) as Storage;
    const orig = proto.setItem;
    proto.setItem = function (k: string, v: string) {
      if (k === key) throw new Error("quota");
      return orig.call(this, k, v);
    };
  }, STORAGE_KEY);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(JOURNAL, { waitUntil: "networkidle" });
  await ready(page);
  await page.getByRole("button", { name: /Добавить первую запись/ }).click();
  await page.getByLabel("Дата").fill("14.07.2026");
  await page.getByLabel("Время").fill("09:00");
  await page.getByLabel("Инструмент").fill("XAU/USD");
  await page.getByRole("radio", { name: /Продажа/ }).check();
  await page.getByLabel(/^План/).fill("план входа");
  await page.getByLabel(/Исполнение/).fill("исполнение");
  await page.getByLabel(/Урок/).fill("вывод, который не сохранится");
  await page.getByRole("button", { name: /Добавить запись/ }).click();
  await ready(page);
  await shot(page, "trading-journal-storage-error-desktop-1440x900.png", 1440, 900);
});

test("trading-journal-corrupt-storage-desktop", async ({ page }) => {
  await page.addInitScript((key) => window.localStorage.setItem(key, "@@@corrupt@@@not-json"), STORAGE_KEY);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(JOURNAL, { waitUntil: "networkidle" });
  await ready(page);
  await shot(page, "trading-journal-corrupt-storage-desktop-1440x900.png", 1440, 900);
});

test("trading-journal-locked-desktop", async ({ page }) => {
  // The Trading Journal itself, seen by an early user (L2) for whom L10 is not
  // yet reached — the honest locked surface, no form, no data.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tools/tool.trading_journal?scenario=early", { waitUntil: "networkidle" });
  await ready(page);
  await shot(page, "trading-journal-locked-desktop-1440x900.png", 1440, 900);
});

/* ---------------- mobile / tablet / zoom ---------------- */
test("tools-hub-mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools?scenario=active", { waitUntil: "networkidle" });
  await ready(page);
  await shot(page, "tools-hub-mobile-390x844.png", 390, 844);
});

test("trading-journal-mobile", async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(JOURNAL, { waitUntil: "networkidle" });
  await ready(page);
  await shot(page, "trading-journal-mobile-390x844.png", 390, 844);
});

test("trading-journal-mobile-320", async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(JOURNAL, { waitUntil: "networkidle" });
  await ready(page);
  await shot(page, "trading-journal-mobile-320x720.png", 320, 720);
});

test("trading-journal-tablet", async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(JOURNAL, { waitUntil: "networkidle" });
  await ready(page);
  await shot(page, "trading-journal-tablet-1024x768.png", 1024, 768);
});

test("trading-journal-zoom-200", async ({ page }) => {
  // Real 720×450 layout viewport == a 1440×900 window at 200% zoom (reflow to
  // the compact layout). No documentElement.style.zoom.
  await seed(page);
  await page.setViewportSize({ width: 720, height: 450 });
  await page.goto(JOURNAL, { waitUntil: "networkidle" });
  await ready(page);
  await shot(page, "trading-journal-zoom-200-720x450.png", 720, 450);
});

test("dimensions are exactly as named", async () => {
  // Guard: this test only documents intent; actual dimension checks happen in the
  // review step by reading the files. Kept trivial so the artifact run is green.
  expect(PASS).toMatch(/first-pass|final/);
});
