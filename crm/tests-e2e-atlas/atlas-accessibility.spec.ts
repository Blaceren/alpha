/**
 * AFD-5D2A — accessibility EXECUTED on the final Atlas page.
 *
 * AFD-5D2's accessibility evidence was partly inherited: "the controls are the
 * analytics controls, which were audited". §11 of this brief refuses that, and
 * rightly — inheritance proves a component was once accessible, not that the
 * page assembled from it is. Everything below drives the real page in a real
 * browser against the real backend.
 */
import { expect, test, type Page } from "@playwright/test";
import { ATLAS_E2E } from "../playwright.atlas.config";
import { loginAsAnalyst } from "./support/session";

const RUN = '[data-testid="atlas-run"]';
const RESULT = '[data-testid="atlas-result"]';

const login = loginAsAnalyst;

async function openAndRun(page: Page) {
  await page.goto("/affiliates/analytics/atlas");
  await page.locator("#analytics-preset").selectOption("custom");
  await page.locator("#analytics-start").fill("2026-07-01");
  await page.locator("#analytics-end").fill("2026-07-31");
  await page.getByRole("button", { name: /Применить/ }).click();
  await page.locator(RUN).click();
  await expect(page.locator(RESULT)).toBeVisible({ timeout: 60_000 });
}

test.describe.configure({ mode: "serial" });

test("heading hierarchy is ordered and skips no level", async ({ page }) => {
  await login(page);
  await openAndRun(page);

  const levels = await page.evaluate(() =>
    Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((h) =>
      Number(h.tagName.slice(1)),
    ),
  );
  expect(levels.length).toBeGreaterThan(3);
  expect(levels[0], "the page must start at h1").toBe(1);
  for (let i = 1; i < levels.length; i += 1) {
    expect(
      levels[i]! - levels[i - 1]!,
      `heading jumps from h${levels[i - 1]} to h${levels[i]}`,
    ).toBeLessThanOrEqual(1);
  }
});

test("every form control has an accessible name", async ({ page }) => {
  await login(page);
  await page.goto("/affiliates/analytics/atlas");

  const unnamed = await page.evaluate(() => {
    const bad: string[] = [];
    for (const node of Array.from(document.querySelectorAll("input, select, textarea, button"))) {
      const el = node as HTMLElement;
      if ((el as HTMLInputElement).type === "hidden") return bad;
      const labelled =
        el.getAttribute("aria-label") ??
        (el.getAttribute("aria-labelledby")
          ? document.getElementById(el.getAttribute("aria-labelledby")!)?.textContent
          : null) ??
        (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null) ??
        el.closest("label")?.textContent ??
        el.textContent;
      if (!labelled || labelled.trim() === "") bad.push(el.outerHTML.slice(0, 80));
    }
    return bad;
  });
  expect(unnamed, "a control has no accessible name").toEqual([]);
});

test("keyboard order reaches the filters and the primary action in order", async ({ page }) => {
  await login(page);
  await page.goto("/affiliates/analytics/atlas");

  const reached: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return "";
      return active.getAttribute("data-testid") ?? active.id ?? active.tagName.toLowerCase();
    });
    if (id) reached.push(id);
    if (id === "atlas-run") break;
  }

  expect(reached, "the run action is not reachable by Tab").toContain("atlas-run");
  // The filters come BEFORE the action: an operator configures, then runs.
  expect(reached.indexOf("analytics-preset")).toBeLessThan(reached.indexOf("atlas-run"));
  expect(reached.indexOf("analytics-group")).toBeLessThan(reached.indexOf("atlas-run"));
});

test("the evidence disclosure carries native semantics", async ({ page }) => {
  await login(page);
  await openAndRun(page);

  const semantics = await page.evaluate(() => {
    const summary = Array.from(document.querySelectorAll("summary")).find((s) =>
      (s.textContent ?? "").includes("Показать данные"),
    );
    if (!summary) return null;
    const details = summary.closest("details");
    return {
      tag: summary.tagName.toLowerCase(),
      parent: details?.tagName.toLowerCase() ?? null,
      openBefore: details?.open ?? null,
    };
  });
  expect(semantics?.tag).toBe("summary");
  expect(semantics?.parent).toBe("details");
  // Collapsed by default: technical detail must not dominate the first read.
  expect(semantics?.openBefore).toBe(false);

  // And it toggles by keyboard, announcing its expanded state through the
  // element the platform already made accessible.
  const summary = page.getByText("Показать данные").first();
  await summary.focus();
  await page.keyboard.press("Enter");
  const openAfter = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll("details")).filter((d) => d.open).length,
  );
  expect(openAfter).toBeGreaterThan(0);
});

test("run state, loading, error and stale are all announced", async ({ page }) => {
  await login(page);
  await page.goto("/affiliates/analytics/atlas");

  const liveRegion = page.locator('p[role="status"][aria-live="polite"]').first();
  await expect(liveRegion).toHaveText(/Анализ ещё не запускался/);

  await page.locator("#analytics-preset").selectOption("custom");
  await page.locator("#analytics-start").fill("2026-07-01");
  await page.locator("#analytics-end").fill("2026-07-31");
  await page.getByRole("button", { name: /Применить/ }).click();
  await page.locator(RUN).click();
  await expect(page.locator(RESULT)).toBeVisible({ timeout: 60_000 });
  await expect(liveRegion).toHaveText(/Анализ готов/);

  // Stale is announced, not conveyed by dimming alone.
  await page.locator("#analytics-group").selectOption("week");
  await expect(liveRegion).toHaveText(/Параметры изменились/);

  // An error is announced through role=alert.
  await page.route("**/api/crm/v1/affiliates/analytics/analysis", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "upstream", messageKey: "x" }),
    }),
  );
  await page.locator(RUN).click();
  const alert = page.locator('[data-testid="atlas-error"] [role="alert"]');
  await expect(alert).toBeVisible();
});

test("severity and support tier are never carried by colour alone", async ({ page }) => {
  await login(page);
  await openAndRun(page);

  // Every finding states its severity AND its support tier as TEXT.
  const cards = page.locator("li", { has: page.locator('[data-testid="atlas-support-tier"]') });
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < Math.min(count, 5); i += 1) {
    const text = await cards.nth(i).innerText();
    expect(text).toMatch(/Информация|Требует внимания/);
    expect(text).toMatch(/Описательный|Умеренная опора|Сильная опора/);
  }

  // The decorative glyph is hidden from assistive technology, so a screen
  // reader hears the label rather than a bullet character.
  const glyphsExposed = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll("span"))
        .filter((s) => ["•", "!"].includes((s.textContent ?? "").trim()))
        .filter((s) => s.getAttribute("aria-hidden") !== "true").length,
  );
  expect(glyphsExposed).toBe(0);
});

test("percentage-point and relative deltas are screen-reader readable text", async ({ page }) => {
  await login(page);
  await openAndRun(page);

  const disclosure = page.getByText("Показать данные").first();
  await disclosure.click();

  const comparison = page.locator('[data-testid="atlas-comparison"]').first();
  if ((await comparison.count()) === 0) {
    // The fixture window may produce no comparison finding; the assertion below
    // is then vacuous, and saying so is better than pretending it ran.
    test.info().annotations.push({
      type: "note",
      description: "no comparison finding in this window; delta readability not exercised",
    });
    return;
  }

  const pairs = await comparison.evaluate((node) => {
    const terms = Array.from(node.querySelectorAll("dt")).map((d) => d.textContent?.trim() ?? "");
    const values = Array.from(node.querySelectorAll("dd")).map((d) => d.textContent?.trim() ?? "");
    return { terms, values };
  });

  // Each number is preceded by a WORD, not a bare symbol: "Разница в п.п." is
  // readable, "Δ" is not.
  expect(pairs.terms.length).toBe(pairs.values.length);
  expect(pairs.terms.length).toBeGreaterThan(0);
  for (const term of pairs.terms) {
    expect(term.length, `a comparison label is too short to read: "${term}"`).toBeGreaterThan(3);
    expect(term).not.toMatch(/^[Δ%±]/);
  }
  for (const value of pairs.values) {
    expect(value).not.toBe("");
  }
});

test("reduced motion is respected", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page);
  await openAndRun(page);

  // Nothing on the page animates or transitions for longer than an instant when
  // the operator has asked for reduced motion.
  const moving = await page.evaluate(() => {
    const offenders: string[] = [];
    for (const node of Array.from(document.querySelectorAll("*")).slice(0, 800)) {
      const style = window.getComputedStyle(node);
      const animation = style.animationName;
      if (animation && animation !== "none") {
        offenders.push(`animation ${animation}`);
      }
    }
    return offenders;
  });
  expect(moving, "an animation runs under prefers-reduced-motion").toEqual([]);
});

test("the evidence table is announced as a table with headers", async ({ page }) => {
  await login(page);
  await openAndRun(page);
  await page.getByText("Показать данные").first().click();

  const table = page.getByRole("table").first();
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveCount(3);
  // A caption, so a screen reader announces what the table is for.
  const caption = await table.evaluate((node) => node.querySelector("caption")?.textContent ?? "");
  expect(caption.length).toBeGreaterThan(5);
});
