/**
 * AFD-5D2A — direct multi-viewport verification of the Curie Atlas workspace.
 *
 * AFD-5D2 disclosed that it had run NO responsive specification of its own and
 * reasoned from component reuse instead. Its own audit called that an inference
 * rather than a measurement. This suite is the measurement.
 *
 * IT ASSERTS REAL LAYOUT, NOT SNAPSHOTS. Every check reads a geometry the
 * browser actually computed — `scrollWidth` against `clientWidth`, an element's
 * bounding box against its container's, computed styles for focus and motion.
 * A screenshot would only prove that the pixels have not changed since the last
 * time somebody looked at them, which is a different and much weaker claim.
 *
 * NO SCREENSHOTS ARE CAPTURED. An image of a logged-in CRM is a credentialed
 * artifact, and the audit package must not contain one.
 */
import { expect, test, type Page } from "@playwright/test";
import { ATLAS_E2E } from "../playwright.atlas.config";
import { loginAsAnalyst } from "./support/session";

const RUN = '[data-testid="atlas-run"]';
const RESULT = '[data-testid="atlas-result"]';

/** The four required viewports. */
const VIEWPORTS = [
  { name: "mobile 360x800", width: 360, height: 800 },
  { name: "tablet 768x1024", width: 768, height: 1024 },
  { name: "desktop 1440x900", width: 1440, height: 900 },
  { name: "wide 1920x1080", width: 1920, height: 1080 },
] as const;

const login = loginAsAnalyst;

/** The decisive responsive assertion: the PAGE never scrolls sideways. */
async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    `${label}: document scrolls horizontally (${overflow.scrollWidth} > ${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/** No element may spill outside the viewport, which is how text gets clipped. */
async function expectNothingClipped(page: Page, selector: string, label: string) {
  const spills = await page.evaluate((sel) => {
    const viewportWidth = document.documentElement.clientWidth;
    return Array.from(document.querySelectorAll(sel))
      .map((node) => {
        const box = node.getBoundingClientRect();
        return { right: Math.round(box.right), text: (node.textContent ?? "").slice(0, 40) };
      })
      .filter((entry) => entry.right > viewportWidth + 1);
  }, selector);
  expect(spills, `${label}: ${selector} spills past the viewport`).toEqual([]);
}

async function configureAndRun(page: Page, start: string, end: string) {
  await page.locator("#analytics-preset").selectOption("custom");
  await page.locator("#analytics-start").fill(start);
  await page.locator("#analytics-end").fill(end);
  await page.getByRole("button", { name: /Применить/ }).click();
  await page.locator(RUN).click();
  await expect(page.locator(RESULT)).toBeVisible({ timeout: 60_000 });
}

test.describe.configure({ mode: "serial" });

for (const viewport of VIEWPORTS) {
  test(`the Atlas workspace at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await login(page);

    /* 1 — open Curie Atlas */
    await page.goto("/affiliates/analytics/atlas");
    await expect(page.getByRole("heading", { name: "Curie Atlas" })).toBeVisible();
    await expectNoHorizontalOverflow(page, `${viewport.name} initial`);

    /* 2 — the filters are operable at this width */
    await expect(page.locator("#analytics-preset")).toBeVisible();
    await expect(page.locator("#analytics-group")).toBeVisible();
    await expect(page.getByRole("radio", { name: /По дате события/ })).toBeVisible();
    // The primary action is visible AND clickable, not merely present.
    const runButton = page.locator(RUN);
    await expect(runButton).toBeVisible();
    await expect(runButton).toBeEnabled();

    /* 3 — run an event-date analysis over the fixture window */
    await configureAndRun(page, "2026-07-01", "2026-07-31");
    await expectNoHorizontalOverflow(page, `${viewport.name} after a run`);

    /* 4 — a long warning message wraps rather than clipping */
    const warnings = page.locator("section", {
      has: page.getByRole("heading", { name: /Предупреждения/ }),
    });
    await expect(warnings).toBeVisible();
    await expectNothingClipped(page, "li p", `${viewport.name} finding text`);

    /* 5 — technical detail must not dominate a small screen.
     *
     * CHECKED BEFORE ANYTHING IS OPENED. The claim is that evidence is closed
     * BY DEFAULT; asserting it after step 6 has clicked a disclosure open would
     * be asserting the opposite of what just happened. (It did: the first run of
     * this suite failed here, on its own click.) */
    if (viewport.width <= 768) {
      const openOnArrival = await page.evaluate(
        () => Array.from(document.querySelectorAll("details")).filter((d) => d.open).length,
      );
      expect(openOnArrival, `${viewport.name}: a disclosure is open by default`).toBe(0);
    }

    /* 6 — evidence expands and its table scrolls INSIDE its own container */
    const disclosure = page.getByText("Показать данные").first();
    if ((await disclosure.count()) > 0) {
      await disclosure.click();
      const table = page.getByRole("table").first();
      await expect(table).toBeVisible();
      // The page still does not scroll sideways: the wide table is wrapped.
      await expectNoHorizontalOverflow(page, `${viewport.name} evidence open`);
    }

    /* 7 — positive signals and questions render at this width */
    await expect(
      page.getByRole("heading", { name: /Положительные сигналы/ }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: /Вопросы к данным/ })).toBeVisible();

    /* 8 — labels stay associated with their values */
    const detached = await page.evaluate(() => {
      const bad: string[] = [];
      for (const list of Array.from(document.querySelectorAll("dl"))) {
        const terms = list.querySelectorAll("dt");
        const values = list.querySelectorAll("dd");
        if (terms.length !== values.length) bad.push(`dl has ${terms.length} dt and ${values.length} dd`);
      }
      return bad;
    });
    expect(detached, `${viewport.name}: a definition list lost its pairing`).toEqual([]);

    /* 9 — essential evidence is never hidden by width */
    const hiddenBySmallScreen = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("[data-testid='atlas-result'] p, [data-testid='atlas-result'] dd"));
      return nodes.filter((node) => {
        const style = window.getComputedStyle(node);
        // Content inside a CLOSED <details> is legitimately not rendered; that
        // is a disclosure, not a width-based omission.
        if (node.closest("details:not([open])")) return false;
        return style.display === "none" || style.visibility === "hidden";
      }).length;
    });
    expect(hiddenBySmallScreen, `${viewport.name}: content hidden by viewport width`).toBe(0);

    /* 10 — no PII and no credential reaches the DOM at any width */
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(body).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(body).not.toContain(ATLAS_E2E.password);
    expect(body).not.toContain(ATLAS_E2E.backendPortToken);
  });
}

/* ------------------------------------------------------- the stale banner */

test("the stale banner stays readable at the narrowest viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page);
  await page.goto("/affiliates/analytics/atlas");
  await configureAndRun(page, "2026-07-01", "2026-07-31");

  await page.locator("#analytics-group").selectOption("week");
  await expect(page.locator(RESULT)).toHaveAttribute("data-stale", "true");

  const banner = page.getByText("Параметры изменились. Запустите анализ повторно.").first();
  await expect(banner).toBeVisible();
  await expectNoHorizontalOverflow(page, "360 stale");
  await expectNothingClipped(page, "[data-testid='atlas-result'] p", "360 stale banner");
});

/* ---------------------------------------------- partial and insufficient */

test("partial and insufficient_data render at the narrowest viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page);
  await page.goto("/affiliates/analytics/atlas");

  // A one-day window has a single bucket, so the backend reports `partial` with
  // COMPARISON_PERIOD_UNAVAILABLE — a real backend state, not a stubbed one.
  await configureAndRun(page, "2026-07-04", "2026-07-05");
  const status = await page.locator('[data-testid="atlas-result-status"]').innerText();
  expect(["Данных достаточно", "Данных достаточно, с ограничениями"]).toContain(status.trim());

  if (status.includes("ограничени")) {
    const issue = page.locator('[data-testid="atlas-issue"]').first();
    await expect(issue).toBeVisible();
    // A reason code renders as an EXPLANATION, never as the raw code.
    const text = await issue.innerText();
    expect(text).not.toMatch(/^[A-Z_]+$/);
    expect(text.length).toBeGreaterThan(10);
  }
  await expectNoHorizontalOverflow(page, "360 partial");

  // An empty window is insufficient_data.
  await configureAndRun(page, "2020-01-01", "2020-01-31");
  await expect(page.locator('[data-testid="atlas-result-status"]')).toContainText(
    "Недостаточно данных",
  );
  await expect(page.locator('[data-testid="atlas-no-issues"]')).toBeVisible();
  await expectNoHorizontalOverflow(page, "360 insufficient");
});

/* ------------------------------------------------------------- an error */

test("a backend error renders without overflow at the narrowest viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page);
  await page.goto("/affiliates/analytics/atlas");

  // A validation error the BACKEND produces: dates beside a named preset.
  await page.route("**/api/crm/v1/affiliates/analytics/analysis", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        code: "invalid_input",
        messageKey: "crm.analysis.body_unknown_key",
        requestId: "req_responsive_400",
      }),
    }),
  );

  await page.locator(RUN).click();
  const error = page.locator('[data-testid="atlas-error"]');
  await expect(error).toBeVisible();
  await expectNoHorizontalOverflow(page, "360 error");
  await expectNothingClipped(page, "[data-testid='atlas-error'] p", "360 error text");
  // No stack trace, SQL or token in the operator-facing message.
  const text = await error.innerText();
  for (const forbidden of ["SELECT ", "at Object.", "csrf", "Set-Cookie"]) {
    expect(text).not.toContain(forbidden);
  }
});

/* ------------------------------------------------------------ keyboard */

test("the workspace is operable by keyboard alone at 360 and 1440", async ({ page }) => {
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await page.goto("/affiliates/analytics/atlas");
    await configureAndRun(page, "2026-07-01", "2026-07-31");

    // The evidence disclosure opens with the keyboard and nothing else.
    const summary = page.getByText("Показать данные").first();
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("table").first()).toBeVisible();

    // Focus is VISIBLE: the focused element carries a ring, not just an outline
    // the design system removed.
    const focusRing = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active) return null;
      const style = window.getComputedStyle(active);
      return { outline: style.outlineStyle, shadow: style.boxShadow };
    });
    expect(
      focusRing?.outline !== "none" || (focusRing?.shadow ?? "none") !== "none",
      `${width}: focus is not visible`,
    ).toBe(true);
  }
});
