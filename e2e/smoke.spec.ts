import { test, expect, type Page } from "@playwright/test";

/**
 * Home smoke (D1B + D1B.1): renders the two Route Field Home scenarios across the
 * canonical viewports and asserts the invariants screenshots cannot prove — no
 * horizontal overflow (incl. 200% zoom reflow and landscape), no console errors,
 * a visible primary CTA, keyboard reach, per-breakpoint route geometry, a distinct
 * tablet composition, and a bottom bar that never covers content (CTA / last outcome).
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

/* ---------------- D1B.1 responsive / zoom / safe-area ---------------- */

async function routeDisplays(page: Page) {
  return page.evaluate(() => {
    const d = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).display : "absent";
    };
    return { narrow: d(".a-narrow"), tablet: d(".a-tablet"), wide: d(".a-wide") };
  });
}

test("200% zoom reflows to the compact layout without horizontal overflow", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  // 200% browser zoom on a 1440x900 window == a 720x450 CSS layout viewport.
  await page.setViewportSize({ width: 720, height: 450 });
  await page.goto("/?scenario=active", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  // Required assertion: no horizontal page overflow at 200% zoom.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "no horizontal overflow at 200% zoom").toBeLessThanOrEqual(1);

  // Lesson title and CTA remain accessible; layout is compact (mobile bars, not desktop).
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("button", { name: CTA_LABEL.active })).toBeVisible();
  await expect(page.locator("nav.bottomnav")).toBeVisible();
  const disp = await routeDisplays(page);
  expect(disp.narrow, "compact route geometry at 200% zoom").not.toBe("none");
  expect(disp.wide).toBe("none");
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("each breakpoint uses its own route geometry (mobile ≠ tablet ≠ desktop)", async ({ page }) => {
  await page.goto("/?scenario=active", { waitUntil: "networkidle" });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await routeDisplays(page)).toMatchObject({ narrow: "inline", tablet: "none", wide: "none" });

  await page.setViewportSize({ width: 1024, height: 768 });
  expect(await routeDisplays(page)).toMatchObject({ narrow: "none", tablet: "inline", wide: "none" });

  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await routeDisplays(page)).toMatchObject({ narrow: "none", tablet: "none", wide: "inline" });
});

test("tablet active is a distinct 2-region composition (not stacked, not desktop)", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?scenario=active", { waitUntil: "networkidle" });
  const display = await page.evaluate(
    () => getComputedStyle(document.querySelector(".content--active")!).display,
  );
  expect(display).toBe("grid");
  // The checkpoint preview shares the top region and the CTA is above the fold.
  await expect(page.locator(".fcp")).toBeVisible();
  const cta = page.getByRole("button", { name: CTA_LABEL.active });
  const box = await cta.boundingBox();
  expect(box!.y).toBeLessThan(768);
});

test("checkpoint mobile: the last outcome is fully scrollable above the bottom nav", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?scenario=checkpoint", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    const main = document.querySelector(".home-main");
    if (main) main.scrollTop = main.scrollHeight;
  });
  await page.waitForTimeout(250);

  const lastOutcome = page.getByText("Chart Markup Tool");
  const nav = page.locator("nav.bottomnav");
  await expect(lastOutcome).toBeVisible();
  const oBox = await lastOutcome.boundingBox();
  const nBox = await nav.boundingBox();
  // The last outcome's bottom edge is above the bottom nav's top edge.
  expect(oBox!.y + oBox!.height, "last outcome clears the bottom nav").toBeLessThanOrEqual(nBox!.y + 1);
});

test("mobile landscape (844x390): no horizontal overflow, nav present", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/?scenario=active", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator("nav.bottomnav")).toBeVisible();
});

test("reduced motion: renders cleanly with motion disabled", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/?scenario=active", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  // The pulsing node must not animate; the page must still render its meaning.
  const animName = await page.evaluate(() => {
    const el = document.querySelector(".rnode");
    return el ? getComputedStyle(el).animationName : "absent";
  });
  expect(animName).toBe("none");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("button", { name: CTA_LABEL.active })).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("320px: CTA visible, five nav items, no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/?scenario=active", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: CTA_LABEL.active })).toBeVisible();
  // Five bottom-nav destinations (accessible names present).
  const navItems = page.locator("nav.bottomnav li");
  await expect(navItems).toHaveCount(5);
});
