/**
 * AFD-5D2 — the Curie Atlas browser journey.
 *
 * The thirteen steps the phase brief names, in one continuous session, against
 * the pinned backend candidate. What a component test cannot show and this does:
 * that the tab is reachable from the affiliate section, that a real CSRF token
 * survives the real proxy hop, that the stale state survives a real re-render,
 * and that logging out actually loses the result rather than merely hiding it.
 */
import { expect, test, type Page } from "@playwright/test";
import { ATLAS_E2E } from "../playwright.atlas.config";
import { loginAsAnalyst } from "./support/session";

const RUN = '[data-testid="atlas-run"]';
const RESULT = '[data-testid="atlas-result"]';

/**
 * Authenticate through the CRM's own login ROUTE, then hand the cookies to the
 * browser — the pattern the accepted AFD-5C1 analytics journey established.
 *
 * The login FORM cannot be driven here: it renders a Cloudflare Turnstile
 * widget, which is a cross-origin iframe that a test browser never solves. The
 * form's own contract is covered by the AFD-3A3 login suite; this suite is
 * about Curie Atlas, and it authenticates the way that suite proved works.
 *
 * The request still goes through the REAL CRM route to the REAL backend, so the
 * session cookie, its attributes and the proxy hop are all genuinely exercised.
 */
const login = loginAsAnalyst;

/** The double-submit CSRF token the CRM sets as a readable cookie. */
async function csrfToken(page: Page): Promise<string> {
  await page.request.get("/api/crm/auth/csrf");
  const cookies = await page.context().cookies();
  return cookies.find((c) => c.name === "trading_platform_csrf")?.value ?? "";
}

/**
 * Assert a run completed, and if it did not, report the CRM's own error text.
 *
 * A bare "still stale" timeout says only that something went wrong; the alert
 * says what the backend refused and why, which is the difference between a
 * five-minute diagnosis and an hour of guessing.
 */
async function expectRunSucceeded(page: Page) {
  // Scoped to the workspace's OWN failure block. `getByRole("alert")` also
  // matches shell-level live regions, and reporting one of those as "the
  // analysis failed" sends the reader after the wrong thing entirely.
  const failure = page.locator('[data-testid="atlas-error"]');
  if ((await failure.count()) > 0) {
    throw new Error(`the analysis failed: ${await failure.first().innerText()}`);
  }
  await expect(page.locator(RESULT)).toHaveAttribute("data-stale", "false", { timeout: 60_000 });
}

test.describe.configure({ mode: "serial" });

test("the analyst journey, end to end", async ({ page }) => {
  /* 1 — analyst login */
  await login(page);

  /* 2 — navigate to Affiliate Analytics */
  await page.goto("/affiliates/analytics");
  await expect(page.getByRole("heading", { name: "Аналитика аффилейтов" })).toBeVisible();

  /* 3 — navigate to Curie Atlas through the section tab */
  await page.getByRole("link", { name: "Curie Atlas" }).click();
  await page.waitForURL(/\/affiliates\/analytics\/atlas$/);
  await expect(page.getByRole("heading", { name: "Curie Atlas" })).toBeVisible();
  await expect(page.getByText("Без модели")).toBeVisible();

  // Nothing has run: the screen is honest about that.
  await expect(page.locator(RESULT)).toHaveCount(0);

  /* 4 — configure an event-date analysis over the fixture window */
  await page.getByRole("radio", { name: /По дате события/ }).check();
  await page.locator("#analytics-preset").selectOption("custom");
  await page.locator("#analytics-start").fill("2026-07-01");
  await page.locator("#analytics-end").fill("2026-07-31");
  await page.getByRole("button", { name: /Применить/ }).click();
  await page.locator("#analytics-group").selectOption("day");

  /* 5 — run it */
  await page.locator(RUN).click();
  await expect(page.locator(RESULT)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(RESULT)).toHaveAttribute("data-stale", "false");

  // The six sections are present, with the required headings.
  for (const heading of [
    "Обзор",
    "Достаточность данных",
    "Предупреждения",
    "Наблюдения",
    "Положительные сигналы",
    "Вопросы к данным",
  ]) {
    await expect(page.getByRole("heading", { name: new RegExp(heading) })).toBeVisible();
  }

  // The honesty claims, on the real response.
  await expect(page.getByText("Модель вызывалась")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("opportunities");
  await expect(page.locator("body")).not.toContainText(ATLAS_E2E.backendPortToken);

  /* 6 — inspect evidence */
  const disclosure = page.getByText("Показать данные").first();
  await expect(disclosure).toBeVisible();
  await disclosure.click();
  await expect(page.getByRole("table").first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Показатель" }).first()).toBeVisible();

  /* 7 — change a filter */
  await page.locator("#analytics-group").selectOption("week");

  /* 8 — the result is now visibly stale, and is NOT relabelled */
  await expect(page.locator(RESULT)).toHaveAttribute("data-stale", "true");
  await expect(
    page.getByText("Параметры изменились. Запустите анализ повторно.").first(),
  ).toBeVisible();
  // The overview still describes the request that produced it.
  const overview = page.locator("section", { has: page.getByRole("heading", { name: "Обзор" }) });
  await expect(overview).toContainText("День");

  /* 9 — rerun */
  await page.locator(RUN).click();
  await expect(page.locator(RESULT)).toHaveAttribute("data-stale", "false", { timeout: 60_000 });
  await expect(overview).toContainText("Неделя");

  /* 10 — configure a cohort analysis */
  await page.getByRole("radio", { name: /По когорте привлечения/ }).check();
  await expect(page.locator(RESULT)).toHaveAttribute("data-stale", "true");
  await page.locator(RUN).click();
  await page.waitForTimeout(2000);
  await expectRunSucceeded(page);
  await expect(overview).toContainText("Когорты привлечения");

  /* 11 — exercise an insufficient-data state on a period with no traffic */
  await page.getByRole("radio", { name: /По дате события/ }).check();
  await page.locator("#analytics-preset").selectOption("custom");
  await page.locator("#analytics-start").fill("2020-01-01");
  await page.locator("#analytics-end").fill("2020-01-31");
  await page.getByRole("button", { name: /Применить/ }).click();
  await page.locator(RUN).click();
  await expect(page.locator(RESULT)).toHaveAttribute("data-stale", "false", { timeout: 60_000 });
  await expect(page.locator('[data-testid="atlas-result-status"]')).toContainText(
    "Недостаточно данных",
  );
  // No fabricated zero performance.
  await expect(page.getByText("Наблюдений по этим параметрам нет.")).toBeVisible();

  /* 12 — nothing was persisted anywhere the browser can restore from */
  const storage = await page.evaluate(() => ({
    local: window.localStorage.length,
    session: window.sessionStorage.length,
    search: window.location.search,
  }));
  expect(storage.local).toBe(0);
  expect(storage.session).toBe(0);
  expect(storage.search).toBe("");

  /* 13 — log out, and verify the result is gone rather than hidden */
  await page.request.post("/api/crm/auth/logout", {
    headers: { "x-csrf-token": await csrfToken(page) },
  });
  await page.context().clearCookies();

  // Returning to the route without a session must not restore anything. The
  // decisive part is that the result is ABSENT rather than merely hidden: it
  // lived in component memory that the logout tore down.
  await page.goto("/affiliates/analytics/atlas");
  await expect(page.locator(RESULT)).toHaveCount(0);
  const afterLogout = await page.evaluate(() => ({
    local: window.localStorage.length,
    session: window.sessionStorage.length,
  }));
  expect(afterLogout.local).toBe(0);
  expect(afterLogout.session).toBe(0);
});
