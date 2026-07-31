import { test, expect, type Page } from "@playwright/test";

/**
 * AFD-5A — real-Chromium responsive and accessibility checks for the affiliate
 * workspace.
 *
 * The affiliate API is STUBBED at the network layer. This suite runs the app in
 * mock mode with no backend, and its subject is the rendered layout — widths,
 * overflow, focus, labels and announcements — not the API contract, which the
 * unit and isolated-E2E suites already cover. Stubbing keeps the fixture
 * deterministic: the same rows at every viewport.
 */

const PARTNERS_ROUTE = "**/api/crm/v1/affiliates/partners*";

function partner(index: number, over: Record<string, unknown> = {}) {
  return {
    id: String(index),
    // Deliberately long, to prove a wide value cannot push the page sideways.
    code: `affiliate-partner-with-a-very-long-code-${index}`,
    displayName: `Партнёрская сеть с очень длинным названием номер ${index}`,
    description: null,
    status: index % 2 === 0 ? "active" : "paused",
    availability: index % 2 === 0 ? "available" : "paused",
    defaultAttributionWindowDays: 30,
    inventory: { campaigns: 2, trackingLinks: 3, activeTrackingLinks: 1 },
    createdBy: { employeeId: `emp_${index}`, displayName: "Demo Operator" },
    createdAt: "2026-07-31T10:00:00.000Z",
    updatedAt: "2026-07-31T10:00:00.000Z",
    archivedAt: null,
    ...over,
  };
}

async function stubPartners(page: Page, count = 5) {
  await page.route(PARTNERS_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: Array.from({ length: count }, (_, i) => partner(i + 1)),
        total: count,
        limit: 25,
        offset: 0,
      }),
    });
  });
}

/** The page body must never scroll sideways, at any width. */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
    };
  });
  // A one-pixel rounding allowance; anything more is a real overflow.
  expect(
    overflow.scrollWidth,
    `page scrolls horizontally: scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

const VIEWPORTS = [
  { name: "1920", width: 1920, height: 1080 },
  { name: "1440", width: 1440, height: 900 },
  { name: "1280", width: 1280, height: 800 },
  { name: "768", width: 768, height: 1024 },
  { name: "390", width: 390, height: 844 },
];

for (const viewport of VIEWPORTS) {
  test(`affiliates list has no page overflow at ${viewport.name}px`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await stubPartners(page);

    await page.goto("/affiliates");
    await expect(page.getByRole("heading", { name: "Аффилейты", level: 1 })).toBeVisible();
    // Wait for rows, so the measurement is of the loaded page, not the skeleton.
    // `visible=true` matters: the wide table and the narrow card list are BOTH
    // in the DOM and CSS decides which one shows, so an unfiltered .first()
    // would resolve to the hidden layout at whichever width it is hidden.
    await expect(
      page
        .getByText("Партнёрская сеть с очень длинным названием номер 1")
        .locator("visible=true")
        .first(),
    ).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });

  test(`affiliates list keeps status and actions reachable at ${viewport.name}px`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await stubPartners(page);
    await page.goto("/affiliates");

    // Status is always readable as TEXT — never colour alone — at every width.
    await expect(page.getByText("Активен").locator("visible=true").first()).toBeVisible();

    // The primary action stays on-screen and clickable rather than clipped.
    const create = page.getByRole("button", { name: "Новый аффилейт" }).first();
    await expect(create).toBeVisible();
    const box = await create.boundingBox();
    expect(box, "create button has no box").not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    // Comfortable touch target on the narrow viewports.
    if (viewport.width <= 768) expect(box!.height).toBeGreaterThanOrEqual(28);
  });
}

test("a wide data table scrolls inside its own container, not the page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await stubPartners(page);
  await page.goto("/affiliates");
  await expect(page.getByRole("table")).toBeVisible();

  // The scroll container is the table's wrapper, so long codes stay reachable
  // without the document itself moving.
  const wrapperScrolls = await page.evaluate(() => {
    const table = document.querySelector("table");
    if (!table) return false;
    let node: HTMLElement | null = table.parentElement;
    while (node) {
      const style = window.getComputedStyle(node);
      if (style.overflowX === "auto" || style.overflowX === "scroll") return true;
      node = node.parentElement;
    }
    return false;
  });
  expect(wrapperScrolls, "the wide table has no horizontal scroll container").toBe(true);
  await expectNoHorizontalOverflow(page);
});

test("the empty state explains itself and does not overflow at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(PARTNERS_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, limit: 25, offset: 0 }),
    }),
  );

  await page.goto("/affiliates");
  await expect(page.getByText("Аффилейтов пока нет")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("a backend failure renders an announced, retryable error", async ({ page }) => {
  await page.route(PARTNERS_ROUTE, (route) => route.fulfill({ status: 500, body: "" }));

  await page.goto("/affiliates");
  // Wait for the route itself to render before asserting on the error state.
  // Under a full-parallel run the dev server compiles this route on first hit,
  // and asserting the alert straight away raced that compile.
  await expect(page.getByRole("heading", { name: "Аффилейты", level: 1 })).toBeVisible({
    timeout: 30_000,
  });

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("the list is keyboard operable with a visible focus ring", async ({ page }) => {
  await stubPartners(page, 2);
  await page.goto("/affiliates");
  await expect(page.getByRole("table")).toBeVisible();

  // Walk the tab order until the search field takes focus, proving the filters
  // are reachable without a mouse.
  let reachedSearch = false;
  for (let i = 0; i < 40 && !reachedSearch; i += 1) {
    await page.keyboard.press("Tab");
    reachedSearch = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      return active?.getAttribute("type") === "search";
    });
  }
  expect(reachedSearch, "the search field was never reachable by keyboard").toBe(true);

  // The focused control must render a visible ring rather than `outline: none`
  // with nothing in its place.
  const hasVisibleFocus = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return false;
    const style = window.getComputedStyle(active);
    return (
      style.outlineStyle !== "none" ||
      style.boxShadow !== "none" ||
      active.className.includes("focus-visible:ring")
    );
  });
  expect(hasVisibleFocus, "the focused control shows no focus indicator").toBe(true);
});

test("the filter controls and table carry accessible names", async ({ page }) => {
  await stubPartners(page, 2);
  await page.goto("/affiliates");

  await expect(page.getByLabel(/Поиск по названию/)).toBeVisible();
  await expect(page.getByLabel("Статус")).toBeVisible();
  await expect(page.getByRole("table")).toHaveAccessibleName("Список аффилейт-партнёров");
  // Exactly one page heading.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
});

test("loading is announced to assistive technology", async ({ page }) => {
  // Hold the response open so the loading state is observable.
  await page.route(PARTNERS_ROUTE, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, limit: 25, offset: 0 }),
    });
  });

  await page.goto("/affiliates");
  await expect(page.getByText("Загрузка списка аффилейтов")).toBeAttached();
});

test("no console errors on the affiliates route", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await stubPartners(page, 3);
  await page.goto("/affiliates");
  await expect(page.getByRole("table")).toBeVisible();
  expect(errors, `console errors: ${errors.join("\n")}`).toHaveLength(0);
});
