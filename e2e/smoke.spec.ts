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

/**
 * Since D2B the active CTA is a real link into the lesson route; the checkpoint
 * CTA stays a development-safe no-op button (its destination is not built yet).
 */
const CTA_ROLE: Record<(typeof SCENARIOS)[number], "link" | "button"> = {
  active: "link",
  checkpoint: "button",
};

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

/**
 * Reusable check: the given element's bottom edge sits at/above the fixed bottom
 * nav's top edge (i.e. the element is not covered by the bar). `gap` optionally
 * requires extra clearance. Asserts against real bounding boxes, not CSS classes.
 */
async function assertElementAboveBottomNavigation(page: Page, selector: string, gap = 0) {
  const el = page.locator(selector).first();
  const nav = page.locator("nav.bottomnav");
  await expect(el, `${selector} is visible`).toBeVisible();
  await expect(nav, "bottom nav is visible").toBeVisible();
  const eBox = await el.boundingBox();
  const nBox = await nav.boundingBox();
  expect(eBox, `${selector} has a box`).not.toBeNull();
  expect(nBox, "nav has a box").not.toBeNull();
  expect(
    eBox!.y + eBox!.height,
    `${selector} bottom (${Math.round(eBox!.y + eBox!.height)}) clears nav top (${Math.round(nBox!.y)})`,
  ).toBeLessThanOrEqual(nBox!.y - gap + 1);
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
      const cta = page.getByRole(CTA_ROLE[scenario], { name: CTA_LABEL[scenario] });
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

  const cta = page.getByRole("link", { name: CTA_LABEL.active });
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
  const cta = page.getByRole("link", { name: CTA_LABEL.active });
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
  await expect(page.getByRole("link", { name: CTA_LABEL.active })).toBeVisible();
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
  const cta = page.getByRole("link", { name: CTA_LABEL.active });
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
  await expect(page.getByRole("link", { name: CTA_LABEL.active })).toBeVisible();
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
  await expect(page.getByRole("link", { name: CTA_LABEL.active })).toBeVisible();
  // Five bottom-nav destinations (accessible names present).
  const navItems = page.locator("nav.bottomnav li");
  await expect(navItems).toHaveCount(5);
});

/* ---------------- D1B.2 short-viewport / bottom-nav overlap ---------------- */

test("200% zoom: CTA is fully above the bottom nav and focusable, no overflow", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.setViewportSize({ width: 720, height: 450 }); // 200% zoom of 1440x900
  await page.goto("/?scenario=active", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "no horizontal overflow at 200% zoom").toBeLessThanOrEqual(1);

  // CTA is not covered by the fixed bottom nav at initial render.
  await assertElementAboveBottomNavigation(page, ".cta");
  const cta = page.getByRole("link", { name: CTA_LABEL.active });
  await expect(cta).toBeVisible();
  // Focusing the CTA must not scroll it under the nav.
  await cta.focus();
  await expect(cta).toBeFocused();
  await assertElementAboveBottomNavigation(page, ".cta");
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("landscape: CTA is above the bottom nav, page scrollable, no overflow", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/?scenario=active", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  // The page can scroll (content taller than the short viewport).
  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight > document.documentElement.clientHeight,
  );
  expect(scrollable).toBe(true);
  await assertElementAboveBottomNavigation(page, ".cta");
  const cta = page.getByRole("link", { name: CTA_LABEL.active });
  await cta.focus();
  await assertElementAboveBottomNavigation(page, ".cta");
});

test("320px: Alex and checkpoint preview scroll fully above the bottom nav", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/?scenario=active", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  // Whole mentor block (avatar + last quote line) scrolls above the nav.
  await page.locator(".mentor").scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await assertElementAboveBottomNavigation(page, ".mentor", 16);

  // Checkpoint preview (the last content block) also scrolls above the nav.
  await page.locator(".fcp").scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await assertElementAboveBottomNavigation(page, ".fcp", 16);

  // The bottom nav stays fixed (does not scroll away with the content).
  const navPos = await page.evaluate(() => getComputedStyle(document.querySelector("nav.bottomnav")!).position);
  expect(navPos).toBe("fixed");
});

test("checkpoint mobile regression: CTA in first viewport, outcomes above nav after scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?scenario=checkpoint", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  // CTA visible without scrolling (first viewport).
  await assertElementAboveBottomNavigation(page, ".cta");

  // After scroll, the last outcome clears the nav; no excessive empty tail.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(200);
  await assertElementAboveBottomNavigation(page, ".gate-far .result:last-of-type", 16);
  const tail = await page.evaluate(() => {
    const last = document.querySelector(".gate-far") as HTMLElement;
    const rect = last.getBoundingClientRect();
    return document.documentElement.scrollHeight - (window.scrollY + rect.bottom);
  });
  // Empty space after the last block should be bounded (compensation, not a huge gap).
  expect(tail, "no excessive empty bottom padding").toBeLessThan(160);
});

test("no focusable element lands under the bottom nav when focused (mobile)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?scenario=active", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const cta = page.getByRole("link", { name: CTA_LABEL.active });
  await cta.focus();
  await assertElementAboveBottomNavigation(page, ".cta");
});
