import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Phase 1B2.2 — sticky row-action verification (kept separate so the main Users
 * screenshot suite is not replaced). Produces screenshots into
 * screenshots/phase-1b2-2-users-sticky-action/ and asserts the sticky behaviour:
 * identity sticky left, action sticky right, visible before AND after horizontal
 * scroll (stable right position), focus not clipped, no page overflow.
 *
 *   npx playwright install chromium   # or system Chrome via channel
 *   npm run test:e2e
 */
const OUT = "screenshots/phase-1b2-2-users-sticky-action";
mkdirSync(OUT, { recursive: true });

test.describe.configure({ mode: "serial" });

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

async function enableOptionalColumns(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Колонки" }).click();
  for (const name of ["Ценностные сегменты", "Регистрация Pocket", "Кампания / источник", "Финансовое представление", "Чистые депозиты"]) {
    await page.getByRole("menuitemcheckbox", { name }).click();
  }
  await page.keyboard.press("Escape");
}

test("sticky action — default desktop layout 1440x900", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users");
  await waitForUsers(page);
  await expect(page.getByRole("link", { name: /Открыть профиль/ }).first()).toBeInViewport();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

  // Blocker chips must not run into the «Ответственный» cell (real layout check).
  const minGap = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    let worst = Infinity;
    for (const row of rows) {
      const tds = Array.from(row.querySelectorAll("td"));
      const ownerTd = tds.find((td) => /^(Retention|Mentor|Support|Moderator|Analyst|Не назначен)/.test(td.textContent?.trim() || ""));
      if (!ownerTd) continue;
      const blockersTd = tds[tds.indexOf(ownerTd) - 1];
      if (!blockersTd) continue;
      const chips = Array.from(blockersTd.querySelectorAll("span")).map((s) => s.getBoundingClientRect().right);
      const chipRight = chips.length ? Math.max(...chips) : blockersTd.getBoundingClientRect().right;
      worst = Math.min(worst, ownerTd.getBoundingClientRect().left - chipRight);
    }
    return worst;
  });
  expect(minGap).toBeGreaterThan(2);

  await page.screenshot({ path: `${OUT}/users-default-1440x900.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("sticky action — optional columns before & after horizontal scroll 1440x900", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users");
  await waitForUsers(page);
  await enableOptionalColumns(page);

  const action = page.getByRole("link", { name: /Открыть профиль/ }).first();
  await expect(action).toBeInViewport();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  const boxBefore = await action.boundingBox();
  await page.screenshot({ path: `${OUT}/users-columns-before-scroll-1440x900.png` });

  // Only the table workspace scrolls (page does not).
  const scrolled = await page.locator("div.overflow-x-auto").first().evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    return el.scrollLeft;
  });
  expect(scrolled).toBeGreaterThan(0);
  await page.waitForTimeout(150);

  // Action still visible, same right-hand zone; page still not overflowing.
  await expect(action).toBeInViewport();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  const boxAfter = await action.boundingBox();
  expect(Math.abs((boxAfter?.x ?? 0) - (boxBefore?.x ?? 0))).toBeLessThan(6);

  // Identity column stays sticky on the left edge of the scroll container.
  const identityGap = await page.evaluate(() => {
    const wrap = document.querySelector("div.overflow-x-auto") as HTMLElement | null;
    const userTd = document.querySelector("tbody tr td");
    if (!wrap || !userTd) return 999;
    return Math.abs(userTd.getBoundingClientRect().left - wrap.getBoundingClientRect().left);
  });
  expect(identityGap).toBeLessThan(2);

  await page.screenshot({ path: `${OUT}/users-columns-after-scroll-1440x900.png` });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("sticky action — keyboard focus not clipped 1440x900", async ({ page }) => {
  const errors = trackConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users");
  await waitForUsers(page);
  await enableOptionalColumns(page);

  const action = page.getByRole("link", { name: /Открыть профиль/ }).first();
  await action.focus();
  await expect(action).toBeFocused();
  await expect(action).toBeInViewport();
  await page.screenshot({ path: `${OUT}/users-columns-action-focus-1440x900.png` });

  // Action navigates to the (placeholder) profile.
  await action.click();
  await expect(page).toHaveURL(/\/users\/usr_/);
  expect(errors, errors.join("\n")).toHaveLength(0);
});
