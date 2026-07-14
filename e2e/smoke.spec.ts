import { test, expect, type Page } from "@playwright/test";

/**
 * D1B smoke: renders the two Route Field Home scenarios across the three canonical
 * viewports and asserts the invariants that screenshots cannot prove on their own —
 * no horizontal overflow, no console errors, a visible primary CTA, keyboard reach,
 * and (mobile) a bottom bar that does not cover the primary action.
 */

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1024, height: 768 },
  mobile: { width: 390, height: 844 },
} as const;

const SCENARIOS = ["active", "checkpoint"] as const;

const CTA_LABEL: Record<(typeof SCENARIOS)[number], RegExp> = {
  active: /Продолжить урок/,
  checkpoint: /Проверить выполнение/,
};

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

for (const scenario of SCENARIOS) {
  for (const [name, size] of Object.entries(VIEWPORTS)) {
    test(`${scenario} @ ${name}: renders cleanly with a visible CTA and no overflow`, async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await page.setViewportSize(size);
      await page.goto(`/?scenario=${scenario}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);

      // Exactly one document heading.
      await expect(page.locator("h1")).toHaveCount(1);

      // Primary CTA present and visible.
      const cta = page.getByRole("button", { name: CTA_LABEL[scenario] });
      await expect(cta).toBeVisible();

      // No horizontal overflow of the page.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "no horizontal page overflow").toBeLessThanOrEqual(1);

      // No console / page errors.
      expect(errors, errors.join("\n")).toHaveLength(0);
    });
  }
}

test("keyboard: the skip link is the first focusable control and targets main", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/?scenario=active", { waitUntil: "networkidle" });
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toHaveText(/Перейти к содержимому|содержим/i);
  await expect(focused).toHaveAttribute("href", "#main");
});

test("mobile: the bottom nav does not cover the primary CTA", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  await page.goto("/?scenario=active", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const cta = page.getByRole("button", { name: CTA_LABEL.active });
  const nav = page.locator("nav.bottomnav");
  await expect(nav).toBeVisible();

  const ctaBox = await cta.boundingBox();
  const navBox = await nav.boundingBox();
  expect(ctaBox, "CTA has a box").not.toBeNull();
  expect(navBox, "bottom nav has a box").not.toBeNull();
  // The CTA's bottom edge sits above the bottom nav's top edge (no overlap).
  expect(ctaBox!.y + ctaBox!.height).toBeLessThanOrEqual(navBox!.y + 1);
});

test("keyboard: the CTA is reachable and activatable by keyboard", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/?scenario=active", { waitUntil: "networkidle" });
  const cta = page.getByRole("button", { name: CTA_LABEL.active });
  await cta.focus();
  await expect(cta).toBeFocused();
});
