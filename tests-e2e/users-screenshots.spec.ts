import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Phase 1B2 — real-browser screenshots of the Users workspace.
 * Produces screenshots/phase-1b2-users/*.png at exact sizes.
 * Also asserts a clean console (no runtime/hydration/asset errors).
 *
 * Run on a machine with a browser:
 *   npx playwright install chromium   # or use system Chrome via channel
 *   npm run test:e2e
 */
const OUT = "screenshots/phase-1b2-users";
mkdirSync(OUT, { recursive: true });

// Serial mode: the tests share one webServer; running them serially avoids
// dev-server recompile contention polluting the per-test console assertions.
test.describe.configure({ mode: "serial" });

const ROLE_STORAGE_KEY = "ata-crm.mock-role.v1";

/**
 * Pre-seed the mock demo role BEFORE the first navigation, using the same
 * persisted session key the in-app dev role switch writes. Seeding before load
 * (instead of switching + reloading afterwards) keeps a single navigation, so
 * no in-flight RSC prefetch is aborted and the console stays clean. Works in
 * both dev and production builds (where the dev-only switch is hidden).
 */
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
  await expect(page.getByRole("link", { name: "Открыть профиль" }).first()).toBeVisible();
}

test("admin desktop 1440x900", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users");
  await waitForUsers(page);
  // Reveal the exact financial column via Columns menu.
  await page.getByRole("button", { name: "Колонки" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Финансовое представление" }).click();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${OUT}/users-admin-1440x900.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("support desktop 1440x900 (permission-safe financial)", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedRole(page, "support");
  await page.goto("/users");
  await waitForUsers(page);
  await page.getByRole("button", { name: "Колонки" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Финансовое представление" }).click();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${OUT}/users-support-1440x900.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("filtered desktop 1440x900 (compound filter, several users)", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users");
  await waitForUsers(page);
  // Funding = funded + Engagement = active → multiple users.
  await page.getByRole("button", { name: /Финансовый статус/ }).click();
  await page.getByRole("menuitemcheckbox", { name: "Фондирован" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Engagement/ }).click();
  await page.getByRole("menuitemcheckbox", { name: "Активен", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "Открыть профиль" }).first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/users-filtered-1440x900.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("tablet 1024x768", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/users");
  await waitForUsers(page);
  await page.screenshot({ path: `${OUT}/users-tablet-1024x768.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("mobile 390x844 (cards + filter sheet)", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Пользователи" })).toBeVisible();
  await page.screenshot({ path: `${OUT}/users-mobile-390x844.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});
