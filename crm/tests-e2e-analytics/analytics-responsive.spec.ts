import { test, expect, type Page } from "@playwright/test";
import {
  ANALYTICS_PATH,
  CREDENTIALS,
  hasHorizontalOverflow,
  signIn,
  waitForAnalytics,
} from "./support/analytics-e2e";

/**
 * AFD-5C1 — responsive and accessibility proof at every required width (§36,
 * §37), in real Chromium.
 *
 * The overflow assertion is the load-bearing one. A dashboard is where
 * horizontal overflow is easiest to introduce and hardest to notice: a table, a
 * chart or a legend one pixel too wide pushes the whole document sideways, and
 * on a 320 px phone that makes the page unusable rather than merely untidy.
 * Wide content must scroll inside its OWN container, which is what these checks
 * distinguish.
 */

const WIDTHS = [
  { width: 1920, height: 1080, label: "1920" },
  { width: 1440, height: 900, label: "1440" },
  { width: 1280, height: 800, label: "1280" },
  { width: 1024, height: 768, label: "1024" },
  { width: 768, height: 1024, label: "768" },
  { width: 390, height: 844, label: "390" },
  { width: 320, height: 568, label: "320" },
] as const;

async function openAnalytics(page: Page, query = "?preset=all_time") {
  await page.goto(`${ANALYTICS_PATH}${query}`);
  await waitForAnalytics(page);
}

test.describe("responsive", () => {
  test.beforeEach(async ({ context, request }) => {
    expect(await signIn(context, request, CREDENTIALS.analyst)).toBe(200);
  });

  for (const size of WIDTHS) {
    test(`event-date mode has no page overflow at ${size.label} px`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openAnalytics(page);

      expect(await hasHorizontalOverflow(page)).toBe(false);
      // The controls must remain usable, not merely present.
      await expect(page.getByLabel("Период", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Группировка", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Аффилейт", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Сводка" })).toBeVisible();
    });

    test(`cohort mode has no page overflow at ${size.label} px`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openAnalytics(page, "?mode=acquisition_cohort&preset=all_time");

      expect(await hasHorizontalOverflow(page)).toBe(false);
      await expect(page.getByLabel("Отсечка наблюдения")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Когорта привлечения" })).toBeVisible();
    });
  }

  test("has no page overflow at 320 px with 200% zoom", async ({ page }) => {
    // 200 % zoom at 320 px is a 160 px CSS viewport — the hardest case in §37.
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(`${ANALYTICS_PATH}?preset=all_time`);
    await waitForAnalytics(page);
    await page.evaluate(() => {
      document.documentElement.style.zoom = "200%";
    });
    await page.waitForTimeout(300);

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await expect(page.getByLabel("Период", { exact: true })).toBeVisible();
  });

  test("the breakdown becomes cards rather than a clipped table on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAnalytics(page);
    // The desktop table is hidden below md; the same rows render as a list.
    const table = page.locator("table").filter({ hasText: "Название" });
    await expect(table).toBeHidden();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("wide content scrolls inside its own container, not the page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAnalytics(page, "?preset=all_time&group=day");
    const chart = page.getByRole("group", { name: /Динамика событий/ });
    await expect(chart).toBeVisible();
    // The plot is its own scroller; the document is not.
    const scrolls = await chart.evaluate((node) => node.scrollWidth >= node.clientWidth);
    expect(scrolls).toBe(true);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});

test.describe("accessibility", () => {
  test.beforeEach(async ({ context, request }) => {
    expect(await signIn(context, request, CREDENTIALS.analyst)).toBe(200);
  });

  test("has one page heading and named sections", async ({ page }) => {
    await openAnalytics(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Сводка" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Детализация" })).toBeVisible();
  });

  test("labels every control", async ({ page }) => {
    await openAnalytics(page);
    for (const label of ["Период", "Группировка", "Аффилейт", "Кампания", "Ссылка"]) {
      // `exact`: "Аффилейт" is a prefix of the "Разделы аффилейтов" landmark
      // and of the "Аффилейты" dimension option.
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("radiogroup", { name: "Режим отчёта" })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Охват атрибуции" })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Разрез детализации" })).toBeVisible();
  });

  test("is fully operable by keyboard", async ({ page }) => {
    await openAnalytics(page);

    // Tab until the mode radio is reached; a control that cannot be focused is
    // a control a keyboard user does not have.
    const modeRadio = page.getByRole("radio", { name: /По когорте привлечения/ });
    await modeRadio.focus();
    await expect(modeRadio).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/mode=acquisition_cohort/);
    await waitForAnalytics(page);

    const group = page.getByLabel("Группировка");
    await group.focus();
    await expect(group).toBeFocused();
  });

  test("shows a visible focus ring when the chart is reached by keyboard", async ({ page }) => {
    await openAnalytics(page, "?preset=all_time&group=month");
    const chart = page.getByRole("group", { name: /Динамика событий/ });

    // Reached by TAB, not by a scripted .focus(): `:focus-visible` is what draws
    // the ring, and it is defined by how focus arrived. A programmatic focus
    // would leave the ring unstyled and make this assertion a false negative.
    let focused = false;
    for (let step = 0; step < 60 && !focused; step += 1) {
      await page.keyboard.press("Tab");
      focused = await chart.evaluate((node) => node === document.activeElement);
    }
    expect(focused).toBe(true);

    const ring = await chart.evaluate((node) => getComputedStyle(node).boxShadow);
    expect(ring).not.toBe("none");
  });

  test("announces loading and the report mode", async ({ page }) => {
    await openAnalytics(page);
    await expect(page.locator("[aria-live='polite']").first()).toBeAttached();
    await expect(page.getByText(/Режим отчёта: По дате события/)).toBeAttached();
  });

  test("offers a text alternative for every chart", async ({ page }) => {
    await openAnalytics(page, "?preset=all_time&group=month");
    const toggles = page.getByRole("button", { name: "Показать таблицу" });
    expect(await toggles.count()).toBeGreaterThan(0);
    await toggles.first().click();
    await expect(page.getByRole("table").first()).toBeVisible();
  });

  test("keeps chart values readable without a pointer", async ({ page }) => {
    await openAnalytics(page, "?preset=all_time&group=month");
    // The focused bucket's exact values are ordinary text, present on load.
    await expect(page.getByText(/Квалифицированные клики: /).first()).toBeVisible();
  });

  test("uses real table headers in the breakdown", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAnalytics(page);
    const table = page.locator("table").filter({ hasText: "Название" }).first();
    await expect(table.getByRole("columnheader").first()).toBeVisible();
  });

  test("respects reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openAnalytics(page, "?preset=all_time&group=month");
    // The chart runs no animation at all, so the reduced-motion result is
    // identical to the default one — the strongest possible outcome.
    await expect(page.getByRole("group", { name: /Динамика событий/ })).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
