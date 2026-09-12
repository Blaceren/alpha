import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { stripFlightRowRefs } from "./rsc-flight";

/**
 * Today workspace screenshot suite (Phase 1B3). Real-browser render — every
 * scenario keeps its own console / viewport / permission assertions.
 *
 *   npx playwright install chromium
 *   npm run test:e2e
 */
const PASS = process.env.TODAY_PASS === "first" ? "first-pass" : "final";
const OUT = `screenshots/phase-1b3-today/${PASS}`;
mkdirSync(OUT, { recursive: true });

test.describe.configure({ mode: "serial" });

const ROLE_STORAGE_KEY = "ata-crm.mock-role.v1";
const STATE_STORAGE_KEY = "ata-crm.mock-state.v1";

/** Seed the dev role BEFORE navigation (same key the role switch writes). */
async function seedRole(page: Page, role: string) {
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [ROLE_STORAGE_KEY, role] as const);
}

/** Seed the dev-only data state (stale / empty / error). */
async function seedState(page: Page, state: string) {
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [STATE_STORAGE_KEY, state] as const);
}

/**
 * Exact balances an admin sees on the Today queue (fixtures 029/014/013/025/
 * 012/015/023/022/021). None is a substring of a bucket label, so finding one
 * in a support-role render is unambiguously a leak.
 */
const EXACT_AMOUNTS_ON_QUEUE = ["$180", "$70", "$82", "$95", "$88", "$130", "$60", "$75", "$80"];

function trackConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

async function waitForQueue(page: Page) {
  await expect(page.getByRole("heading", { name: "Сегодня", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /Открыть профиль/ }).first()).toBeVisible();
}

/**
 * The visible copy of a piece of row text. Desktop rows and mobile cards are
 * both in the DOM with one hidden by CSS (the Users workspace does the same), so
 * a bare text locator matches twice — `visible` picks the one this viewport shows.
 */
function visibleText(page: Page, text: string) {
  return page.getByText(text).locator("visible=true").first();
}

async function pageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("admin desktop 1440x900", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/today");
  await waitForQueue(page);

  // The working day comes from the provider clock, not the browser.
  await expect(visibleText(page, "понедельник, 13 июля 2026")).toBeVisible();
  // The most urgent section leads, and its first user is readable without scrolling.
  await expect(page.getByRole("heading", { name: "Просрочено" })).toBeVisible();
  await expect(visibleText(page, "Открыт support-блокер.")).toBeVisible();

  await page.screenshot({ path: `${OUT}/today-admin-1440x900.png` });
  expect(await pageOverflow(page)).toBe(0);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("support desktop 1440x900 (permission-safe)", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedRole(page, "support");
  await page.goto("/today");
  await waitForQueue(page);

  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const html = stripFlightRowRefs(await page.content());

  // Named exact amounts rather than /\$\d/: a bucket label IS "$50–99", so a
  // pattern would flag the very projection support is supposed to get. These are
  // the real balances an admin sees on this queue, chosen not to collide with
  // any bucket label.
  for (const amount of EXACT_AMOUNTS_ON_QUEUE) {
    expect(body, `exact amount ${amount} leaked to support`).not.toContain(amount);
    expect(html, `exact amount ${amount} in the DOM/attributes`).not.toContain(amount);
  }
  // The checkpoint delta reconstructs a balance from a published grid: withheld.
  expect(body).not.toContain("осталось 5%");
  expect(body).not.toContain("осталось 12%");
  // Buckets are what support may see, and it does see them.
  await expect(visibleText(page, "$50–99")).toBeVisible();

  await page.screenshot({ path: `${OUT}/today-support-1440x900.png` });
  expect(await pageOverflow(page)).toBe(0);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("retention desktop 1440x900", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedRole(page, "retention_manager");
  await page.goto("/today");
  await waitForQueue(page);

  await expect(visibleText(page, "Retention-менеджер")).toBeVisible();
  await page.screenshot({ path: `${OUT}/today-retention-1440x900.png` });
  expect(await pageOverflow(page)).toBe(0);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("high-priority queue 1440x900", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/today");
  await waitForQueue(page);

  // Filter down to the work that cannot wait.
  await page.getByRole("button", { name: /Приоритет/ }).click();
  await page.getByRole("menuitemcheckbox", { name: "Критический" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Наблюдение" })).toHaveCount(0);

  await page.screenshot({ path: `${OUT}/today-high-priority-1440x900.png` });
  expect(await pageOverflow(page)).toBe(0);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("filtered queue 1440x900 (active filters visible)", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/today");
  await waitForQueue(page);

  await page.getByRole("button", { name: /Основание/ }).click();
  await page.getByRole("menuitemcheckbox", { name: "Mentor-проверка" }).click();
  await page.keyboard.press("Escape");

  // The active filter is visible and removable…
  await expect(page.getByLabel("Убрать фильтр Mentor-проверка")).toBeVisible();
  // …and the QUEUE has actually re-read. The chip appears from local state
  // immediately, so asserting only on it screenshotted the unfiltered queue
  // sitting under an active filter. Wait for a non-matching user to leave.
  await expect(visibleText(page, "Открыт support-блокер.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Наблюдение" })).toHaveCount(0);

  await page.screenshot({ path: `${OUT}/today-filtered-1440x900.png` });
  expect(await pageOverflow(page)).toBe(0);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("empty queue 1440x900 (no work vs no results are different)", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedState(page, "empty");
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "Сегодня", level: 1 })).toBeVisible();

  // An empty dataset is a fact about the DATA. An admin must never be told the
  // queue is "недоступна для вашей роли" — /today is visible to every role.
  await expect(page.getByText("В базе пока нет пользователей")).toBeVisible();
  await expect(page.getByText(/недоступна для вашей роли/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Открыть профиль/ })).toHaveCount(0);

  await page.screenshot({ path: `${OUT}/today-empty-1440x900.png` });
  expect(await pageOverflow(page)).toBe(0);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("stale queue 1440x900 (queue stays usable)", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedState(page, "stale");
  await page.goto("/today");
  await waitForQueue(page);

  // The age comes from provider metadata, not from the browser clock.
  await expect(page.getByText(/Данные обновлены \d+ мин назад/).first()).toBeVisible();
  // Stale data is still the day's work: the queue is not withheld.
  await expect(page.getByRole("link", { name: /Открыть профиль/ }).first()).toBeVisible();

  await page.screenshot({ path: `${OUT}/today-stale-1440x900.png` });
  expect(await pageOverflow(page)).toBe(0);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("tablet 1024x768", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/today");
  await waitForQueue(page);

  // Rows survive as rows (no cropped desktop table, no card fallback).
  await expect(visibleText(page, "Открыт support-блокер.")).toBeVisible();
  // Filters remain reachable, via the sheet at this width.
  await expect(page.getByRole("button", { name: /Фильтры/ })).toBeVisible();

  await page.screenshot({ path: `${OUT}/today-tablet-1024x768.png` });
  expect(await pageOverflow(page)).toBe(0);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("mobile 390x844", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today");
  await waitForQueue(page);

  // Cards, not a horizontally-scrolled table.
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(visibleText(page, "Открыт support-блокер.")).toBeVisible();

  // The action is a real touch target.
  const action = page.getByRole("link", { name: /Открыть профиль/ }).first();
  const box = await action.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  await page.screenshot({ path: `${OUT}/today-mobile-390x844.png` });
  expect(await pageOverflow(page)).toBe(0);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("mobile filter sheet 390x844", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today");
  await waitForQueue(page);

  await page.getByRole("button", { name: /Фильтры/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // The sheet fits the viewport rather than overflowing it.
  const sheet = await page.getByRole("dialog").boundingBox();
  expect(sheet!.x).toBeGreaterThanOrEqual(0);
  expect(sheet!.x + sheet!.width).toBeLessThanOrEqual(390);
  await expect(page.getByText(/Найдено:/).first()).toBeVisible();

  await page.screenshot({ path: `${OUT}/today-mobile-filters-390x844.png` });
  expect(await pageOverflow(page)).toBe(0);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("200% zoom 720x450", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 720, height: 450 });
  await page.goto("/today");
  await waitForQueue(page);

  // Exactly one h1 survives the zoom, and the queue is still reachable.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Фильтры/ })).toBeVisible();

  await page.screenshot({ path: `${OUT}/today-zoom-200.png` });
  expect(await pageOverflow(page)).toBe(0);
  expect(errors, errors.join("\n")).toHaveLength(0);
});
