import { test, expect, type Page } from "@playwright/test";

/**
 * Path E2E (§24 D2A): real browser render of /path across viewports and
 * scenarios; navigation, detail, keyboard, reduced motion; no horizontal
 * overflow; no console/page errors; no hydration warnings; bounded DOM size.
 */

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1024, height: 768 },
  mobile: { width: 390, height: 844 },
  mobile320: { width: 320, height: 720 },
  landscape: { width: 844, height: 390 },
  zoom200: { width: 720, height: 450 },
} as const;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    const t = msg.text();
    if (msg.type() === "error") errors.push(t);
    // Hydration problems surface as warnings/errors mentioning "hydrat"
    if (/hydrat/i.test(t)) errors.push(`HYDRATION: ${t}`);
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "no horizontal page overflow").toBeLessThanOrEqual(1);
}

for (const [name, size] of Object.entries(VIEWPORTS)) {
  test(`active @ ${name}: renders with current node, no overflow, clean console`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize(size);
    await page.goto("/path?scenario=active", { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);

    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText("Путь");
    await expect(page.locator('.pnode[aria-current="step"]')).toBeVisible();
    await noHorizontalOverflow(page);
    expect(errors, errors.join("\n")).toHaveLength(0);
  });
}

test("checkpoint scenario @ desktop + mobile", async ({ page }) => {
  const errors = collectErrors(page);
  for (const size of [VIEWPORTS.desktop, VIEWPORTS.mobile]) {
    await page.setViewportSize(size);
    await page.goto("/path?scenario=checkpoint", { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    // The L20 gate is the current step
    await expect(page.locator('.pnode[data-level="20"]')).toHaveAttribute("aria-current", "step");
    await noHorizontalOverflow(page);
  }
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("advanced scenario near L85 keeps the layout intact", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/path?scenario=advanced", { waitUntil: "networkidle" });
  await expect(page.locator('.pnode[data-level="85"]')).toHaveAttribute("aria-current", "step");
  await expect(page.getByText("Модуль 17 из 20").first()).toBeVisible();
  await noHorizontalOverflow(page);
});

test("module navigator: completed + future module selection, then return to current", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/path?scenario=active", { waitUntil: "networkidle" });

  const nav = page.getByRole("navigation", { name: "Модули пути" });
  await nav.getByRole("button", { name: /Модуль 1 «Первое знакомство»/ }).click();
  await expect(page.getByText("Модуль 1 из 20").first()).toBeVisible();

  await nav.getByRole("button", { name: /Модуль 12 «Исполнение»/ }).click();
  await expect(page.getByText("Модуль 12 из 20").first()).toBeVisible();

  await page.getByRole("button", { name: "К текущему уровню" }).click();
  await expect(page.getByText("Модуль 4 из 20").first()).toBeVisible();
  await expect(page.locator('.pnode[data-level="18"]')).toHaveAttribute("aria-current", "step");
});

test("level detail: desktop side plane keeps the map visible", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/path?scenario=active", { waitUntil: "networkidle" });
  await page.locator('.pnode[data-level="18"]').click();

  const detail = page.locator(".path-detail");
  await expect(detail).toBeVisible();
  await expect(detail.getByText("Поддержка и сопротивление")).toBeVisible();
  // The map (canvas) stays visible next to the detail plane
  await expect(page.locator(".path-canvas")).toBeVisible();
  const canvasBox = await page.locator(".path-canvas").boundingBox();
  expect(canvasBox!.width).toBeGreaterThan(500);
  await detail.getByRole("button", { name: "Закрыть детали уровня" }).click();
  await expect(detail).toHaveCount(0);
});

test("level detail: mobile sheet sits above the bottom navigation", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  await page.goto("/path?scenario=active", { waitUntil: "networkidle" });
  await page.locator('.pnode[data-level="18"]').click();

  const detail = page.locator(".path-detail");
  await expect(detail).toBeVisible();
  const dBox = await detail.boundingBox();
  const navBox = await page.locator("nav.bottomnav").boundingBox();
  // Sheet bottom edge is above the bottom nav top edge
  expect(dBox!.y + dBox!.height).toBeLessThanOrEqual(navBox!.y + 1);
});

test("keyboard: arrows, Enter, Escape, Home on the field", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/path?scenario=active", { waitUntil: "networkidle" });

  await page.locator('.pnode[data-level="18"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('.pnode[data-level="19"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".path-detail")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".path-detail")).toHaveCount(0);
  await page.keyboard.press("Home");
  await expect(page.locator('.pnode[data-level="18"]')).toBeFocused();
});

test("reduced motion: current node does not animate; page stays meaningful", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/path?scenario=active", { waitUntil: "networkidle" });
  const animName = await page.evaluate(() => {
    const marker = document.querySelector(".pn-current .marker");
    return marker ? getComputedStyle(marker).animationName : "absent";
  });
  expect(animName).toBe("none");
  await expect(page.locator('.pnode[aria-current="step"]')).toBeVisible();
});

test("performance envelope: bounded rendered nodes and SVG elements", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/path?scenario=active", { waitUntil: "networkidle" });
  const counts = await page.evaluate(() => ({
    nodes: document.querySelectorAll(".pnode").length,
    svgEls: document.querySelectorAll(".path-svg *").length,
  }));
  // One module window: 4–6 level nodes, never all 100.
  expect(counts.nodes).toBeLessThanOrEqual(8);
  expect(counts.nodes).toBeGreaterThanOrEqual(4);
  expect(counts.svgEls).toBeLessThanOrEqual(30);
});

test("home regression: / still renders with its CTA and clean console", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/?scenario=active", { waitUntil: "networkidle" });
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("link", { name: /Продолжить урок/ })).toBeVisible();
  // Путь is now a real link in the app bar
  const pathLink = page.locator('nav.rnav a[href="/path"]');
  await expect(pathLink).toBeVisible();
  await pathLink.click();
  await expect(page.locator("h1")).toHaveText("Путь");
  expect(errors, errors.join("\n")).toHaveLength(0);
});
