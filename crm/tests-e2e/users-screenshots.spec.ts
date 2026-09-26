import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Users workspace screenshot suite (5 canonical scenarios). Real-browser render;
 * each scenario keeps its own console / viewport / permission assertions.
 * Sticky-action coverage lives separately in `users-sticky-action.spec.ts`.
 *
 *   npx playwright install chromium   # or system Chrome via channel
 *   npm run test:e2e
 */
const OUT = "screenshots/phase-1b2-1-users-hardening";
mkdirSync(OUT, { recursive: true });

test.describe.configure({ mode: "serial" });

const ROLE_STORAGE_KEY = "ata-crm.mock-role.v1";

/** Pre-seed the mock role BEFORE navigation (same key the dev role switch writes). */
async function seedRole(page: import("@playwright/test").Page, roleCode: string) {
  await page.addInitScript(
    ([key, role]) => window.localStorage.setItem(key, role),
    [ROLE_STORAGE_KEY, roleCode] as const,
  );
}

function trackConsole(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

async function waitForUsers(page: import("@playwright/test").Page) {
  await expect(page.getByRole("heading", { name: "Пользователи" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Открыть профиль/ }).first()).toBeVisible();
}

async function pageOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("admin desktop 1440x900", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users");
  await waitForUsers(page);
  // Table is rendered and the row action is reachable.
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("link", { name: /Открыть профиль/ }).first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/users-admin-1440x900.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("support desktop 1440x900 (permission-safe financial)", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedRole(page, "support");
  await page.goto("/users");
  await waitForUsers(page);
  // Reveal the financial column — support gets a bucket, never an exact amount.
  await page.getByRole("button", { name: "Колонки" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Финансовое представление" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("диапазон").first()).toBeVisible(); // bucket representation
  const html = await page.content();
  expect(html).not.toContain("@example.test"); // full synthetic email never leaks
  expect(html).toContain("***"); // identity is masked
  await page.screenshot({ path: `${OUT}/users-support-1440x900.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("filtered desktop 1440x900 (compound filters + chips + reset)", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users");
  await waitForUsers(page);
  // Финансовый статус = Фондирован + Активность = Активен.
  await page.getByRole("button", { name: /Финансовый статус/ }).click();
  await page.getByRole("menuitemcheckbox", { name: "Фондирован" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Активность/ }).click();
  await page.getByRole("menuitemcheckbox", { name: "Активен", exact: true }).click();
  await page.keyboard.press("Escape");
  // Compound filters apply: count reflects two active filters, chips + reset shown.
  await expect(page.getByText(/фильтров: 2/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Сбросить всё" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Открыть профиль/ }).first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/users-filtered-1440x900.png` });
  // «Сбросить всё» clears the filters.
  await page.getByRole("button", { name: "Сбросить всё" }).click();
  await expect(page.getByText(/фильтров:/)).toHaveCount(0);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("tablet 1024x768 (compact representation)", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/users");
  await waitForUsers(page);
  // Compact table: row action reachable, no horizontal page overflow.
  await expect(page.getByRole("link", { name: /Открыть профиль/ }).first()).toBeInViewport();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${OUT}/users-tablet-1024x768.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("mobile 390x844 (cards + filter sheet + active count)", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Пользователи" })).toBeVisible();
  // Mobile cards render with a reachable «Открыть профиль» action.
  await expect(page.getByRole("link", { name: /Открыть профиль/ }).first()).toBeVisible();
  // Filter sheet applies a filter and the button reflects the active count.
  await page.getByRole("button", { name: /Фильтры/ }).click();
  await page.getByRole("button", { name: /Финансовый статус/ }).click();
  await page.getByRole("menuitemcheckbox", { name: "Фондирован" }).click();
  await page.keyboard.press("Escape"); // close the dropdown
  await page.keyboard.press("Escape"); // close the sheet
  await expect(page.getByRole("button", { name: /Фильтры \(1\)/ })).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1); // no horizontal overflow
  await page.screenshot({ path: `${OUT}/users-mobile-390x844.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});
