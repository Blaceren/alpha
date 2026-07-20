import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { stripFlightRowRefs } from "./rsc-flight";

/**
 * Phase 1C.1 — provider privacy consistency, proved in a real browser.
 *
 * Additive only: the existing suites (smoke 5, users-screenshots 5,
 * users-sticky-action 3, user-360 13) are untouched and still run.
 *
 * These scenarios cover what unit tests cannot: that the corrected financial
 * semantics actually reach the rendered Users workspace, and that no exact
 * amount survives into the served document for an unprivileged role.
 */
const OUT = "screenshots/phase-1c1-provider-privacy";
mkdirSync(OUT, { recursive: true });

test.describe.configure({ mode: "serial" });

const ROLE_STORAGE_KEY = "ata-crm.mock-role.v1";

/** Nadia Novak — a real fixture that has never had a balance. */
const NO_BALANCE_USER = "Nadia Novak";
/** Nina Chmiel — balance $90 → bucket $50–99 for support. */
const EXACT_BALANCE = "$90";

async function seedRole(page: Page, roleCode: string) {
  await page.addInitScript(
    ([key, role]) => window.localStorage.setItem(key, role),
    [ROLE_STORAGE_KEY, roleCode] as const,
  );
}

function trackConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

/** Reveal the optional financial column (hidden by default). */
async function showBalanceColumn(page: Page) {
  await page.getByRole("button", { name: "Колонки" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Финансовое представление" }).click();
  await page.keyboard.press("Escape");
}

/**
 * Search, then wait for the debounced provider read to settle on one row.
 * `exact` matters: the row action's accessible name is «Открыть профиль <имя>»,
 * so a substring match would resolve to two links.
 */
async function searchForSingleUser(page: Page, query: string, name: string) {
  await page.getByPlaceholder("Имя, email или ID").fill(query);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
}

test("Users: a user with no balance reads «Нет данных», not «Недоступно для роли»", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Пользователи" })).toBeVisible();

  await showBalanceColumn(page);
  // Scope to the one fixture that genuinely has no financial data.
  await searchForSingleUser(page, "Nadia", NO_BALANCE_USER);

  // The admin MAY see exact financials, so a permission message would be false.
  await expect(page.getByText("Нет данных").first()).toBeVisible();
  const html = stripFlightRowRefs(await page.content());
  expect(html).not.toContain("Недоступно для роли");

  await page.screenshot({ path: `${OUT}/users-no-financial-data-1440x900.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("Users: read_only sees «Недоступно для роли» for a user who does have a balance", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedRole(page, "read_only");
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Пользователи" })).toBeVisible();

  await showBalanceColumn(page);
  await searchForSingleUser(page, "Nina", "Nina Chmiel");

  // The value exists but the role may not see it — the opposite of the case above.
  await expect(page.getByText("Недоступно для роли").first()).toBeVisible();
  const html = stripFlightRowRefs(await page.content());
  expect(html).not.toContain(EXACT_BALANCE);
  expect(html).not.toContain("Нет данных");

  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("Users: support gets a bucket and no exact amount in the served document", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedRole(page, "support");
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Пользователи" })).toBeVisible();

  await showBalanceColumn(page);
  await searchForSingleUser(page, "Nina", "Nina Chmiel");
  await expect(page.getByText("$50–99").first()).toBeVisible();

  const html = stripFlightRowRefs(await page.content());
  expect(html).not.toContain(EXACT_BALANCE);
  expect(html).not.toContain("@example.test");

  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("Users mobile: no financial value, so it cannot disagree with the table", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await seedRole(page, "support");
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Пользователи" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Открыть профиль/ }).first()).toBeVisible();

  // Mobile cards deliberately carry no financial column; whatever the role, the
  // exact amount must not appear, and no hidden-state text can contradict desktop.
  const html = stripFlightRowRefs(await page.content());
  expect(html).not.toContain(EXACT_BALANCE);
  expect(html).not.toContain("диапазон");

  expect(errors, errors.join("\n")).toHaveLength(0);
});
