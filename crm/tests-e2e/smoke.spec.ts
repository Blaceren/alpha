import { test, expect } from "@playwright/test";

/**
 * Phase 1A smoke suite. Boots the shell in mock mode and checks the essentials.
 * Intentionally small — no full e2e coverage.
 */

test("no console errors and /today loads with the shell", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/today");
  // `level: 1` pins the page heading. Playwright matches an accessible name by
  // substring, so a bare "Сегодня" also matched the Phase 1B3 queue section
  // «Требует внимания сегодня» — two headings, strict-mode violation. Same
  // intent as before: the page loaded and is titled.
  await expect(page.getByRole("heading", { name: "Сегодня", level: 1 })).toBeVisible();
  // Desktop navigation landmark = <nav aria-label="Разделы CRM"> inside the sidebar.
  // (Stale assertion fix: "Боковая навигация" is the name of the complementary
  //  <aside> container, not the navigation role; the shell splits them into two
  //  landmarks. We check the real navigation landmark by role + accessible name.)
  await expect(page.getByRole("navigation", { name: "Разделы CRM" })).toBeVisible();
  await expect(page.getByText("DEMO MODE").first()).toBeVisible();

  expect(errors, `console errors: ${errors.join("\n")}`).toHaveLength(0);
});

test("root redirects to /today", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/today$/);
});

test("sidebar navigation reaches Users", async ({ page }) => {
  await page.goto("/today");
  await page.getByRole("link", { name: "Пользователи" }).click();
  await expect(page).toHaveURL(/\/users$/);
  await expect(page.getByRole("heading", { name: "Пользователи" })).toBeVisible();
});

test("dev-only role switch changes visible sections", async ({ page }) => {
  await page.goto("/today");
  // Admin sees Settings.
  await expect(page.getByRole("link", { name: "Настройки" })).toBeVisible();

  // Switch to read_only via the role switch.
  await page.getByRole("button", { name: /Роль:/ }).click();
  await page.getByRole("menuitemradio", { name: "Только просмотр" }).click();

  // Settings should disappear for read_only.
  await expect(page.getByRole("link", { name: "Настройки" })).toHaveCount(0);
});

test("unknown route shows the not-found page", async ({ page }) => {
  await page.goto("/definitely-not-a-route");
  await expect(page.getByRole("heading", { name: "Страница не найдена" })).toBeVisible();
});
