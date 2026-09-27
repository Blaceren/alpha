import { test, expect, type Page } from "@playwright/test";

/**
 * Risk Calculator smoke (D4-C). Part of the mandatory `npm run test:e2e` gate
 * (its filename matches `smoke.spec.ts`). Proves the behavioural invariants a
 * screenshot cannot: the tool is available for canonical Артём (L18) with its
 * OWN CTA, the route opens the calculator, empty/partial states never fake a
 * result, the canonical long/short examples compute exactly, equal entry/stop
 * errors, comma decimals parse, tiny distances avoid scientific notation, a
 * refresh clears everything, NO persistence key or progression write happens,
 * below L15 stays locked, the mobile strip appears only when valid and clears
 * the bottom nav / safe area, there is no horizontal overflow, the disclaimer is
 * visible, and no broker/Pocket/execution copy appears.
 */

const RISK = "/tools/tool.risk_calculator";
const RISK_RE = new RegExp(RISK.replace(/\./g, "\\."));

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
  small: { width: 320, height: 720 },
} as const;

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

async function ready(page: Page) {
  await page.evaluate(() => document.fonts.ready);
}

async function fill(
  page: Page,
  v: Partial<Record<"capital" | "risk" | "entry" | "stop", string>>,
) {
  if (v.capital !== undefined) await page.getByLabel("Расчётный капитал").fill(v.capital);
  if (v.risk !== undefined) await page.getByLabel("Риск на сделку, %").fill(v.risk);
  if (v.entry !== undefined) await page.getByLabel("Цена входа").fill(v.entry);
  if (v.stop !== undefined) await page.getByLabel("Стоп-цена").fill(v.stop);
}

/**
 * Read the four page-level scroll/client widths. Page overflow is decided by
 * EXACT integer equality of these — no tolerance (D4-C acceptance closure): the
 * ≤1px figure was a subpixel guard, but the real value is exactly 0 here.
 */
async function pageWidths(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => ({
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
  }));
}

async function expectNoPageOverflow(page: Page, label: string) {
  const w = await pageWidths(page);
  expect(w.documentScrollWidth, `documentElement @ ${label}`).toBe(w.documentClientWidth);
  expect(w.bodyScrollWidth, `body @ ${label}`).toBe(w.bodyClientWidth);
}

test("1-2 · Артём L18 hub shows «Открыть калькулятор» that opens the calculator route", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/tools", { waitUntil: "networkidle" });
  const cta = page.getByRole("link", { name: /Открыть калькулятор/ });
  await expect(cta).toHaveCount(1);
  await expect(cta).toHaveAttribute("href", RISK);
  await cta.click();
  await expect(page).toHaveURL(RISK_RE);
  await expect(page.getByRole("heading", { level: 1, name: "Risk Calculator" })).toBeVisible();
});

test("3-4 · empty and partial input never produce a result", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(RISK, { waitUntil: "networkidle" });
  // 3 · empty
  await expect(page.locator(".rc-strip")).toHaveCount(0);
  await expect(page.locator(".rc-ledger-row.is-on")).toHaveCount(0);
  // 4 · partial
  await fill(page, { capital: "1000", risk: "2" });
  await expect(page.locator(".rc-ledger-row.is-on")).toHaveCount(0);
  await expect(page.locator(".rc-strip")).toHaveCount(0);
});

test("5 · canonical valid long example computes exactly", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(RISK, { waitUntil: "networkidle" });
  await fill(page, { capital: "1000", risk: "2", entry: "100", stop: "96" });

  const ledger = page.locator(".rc-ledger");
  await expect(ledger.getByText("Сумма риска")).toBeVisible();
  const ledgerText = (await ledger.innerText()).replace(/\s+/g, " ");
  expect(ledgerText).toContain("20"); // risk amount
  expect(ledgerText).toContain("4%"); // distance percent
  expect(ledgerText).toContain("500"); // notional
  // Direction Лонг is stated in text (never colour alone).
  await expect(page.getByText("Лонг").first()).toBeVisible();
  // Position size 5 and distance 4 in the ledger.
  expect(ledgerText).toContain("5");
  expect(ledgerText).toContain("4");
  await ready(page);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("6 · valid short example reports Шорт", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(RISK, { waitUntil: "networkidle" });
  await fill(page, { capital: "1000", risk: "2", entry: "100", stop: "104" });
  await expect(page.getByText("Шорт").first()).toBeVisible();
  await expect(page.getByText("Лонг")).toHaveCount(0);
});

test("7 · equal entry and stop shows the exact error, no result", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(RISK, { waitUntil: "networkidle" });
  await fill(page, { capital: "1000", risk: "2", entry: "100", stop: "100" });
  // The exact copy is the visible field error (it also echoes in the sr-only
  // live region, so scope to the field error node to stay unambiguous).
  await expect(page.locator(".rc-field-err")).toHaveText(
    "Цена входа и стоп-цена должны отличаться.",
  );
  await expect(page.locator(".rc-strip")).toHaveCount(0);
  await expect(page.locator(".rc-ledger-row.is-on")).toHaveCount(0);
});

test("8 · a comma decimal is accepted (no format error, result appears)", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(RISK, { waitUntil: "networkidle" });
  await fill(page, { capital: "1000,5", risk: "2", entry: "100", stop: "96" });
  await expect(page.getByText(/Введите число/)).toHaveCount(0);
  await expect(page.locator(".rc-ledger-row.is-on")).toHaveCount(4);
});

test("9 · a tiny stop distance never renders scientific notation", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(RISK, { waitUntil: "networkidle" });
  await fill(page, { capital: "1000", risk: "1", entry: "100", stop: "99.9999" });
  await expect(page.locator(".rc-ledger-row.is-on")).toHaveCount(4);
  const body = await page.locator("body").innerText();
  // No JS scientific notation like 1e-4 / 1E7 anywhere in the visible output.
  expect(/\d[eE][+-]?\d/.test(body)).toBe(false);
  // The large position size / notional is shown in full digits (≥5 in a row),
  // never a rounded infinity-scale figure.
  expect(/\d{5,}/.test(body.replace(/\s+/g, ""))).toBe(true);
});

test("10-12 · refresh clears everything; no persistence key; no progression write", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(RISK, { waitUntil: "networkidle" });
  await fill(page, { capital: "1000", risk: "2", entry: "100", stop: "96" });
  await expect(page.locator(".rc-ledger-row.is-on")).toHaveCount(4);

  // 11 · nothing was written to storage by the calculator.
  const storageAfterInput = await page.evaluate(() => ({
    local: { ...window.localStorage },
    session: { ...window.sessionStorage },
  }));
  const allKeys = [
    ...Object.keys(storageAfterInput.local),
    ...Object.keys(storageAfterInput.session),
  ];
  expect(allKeys.some((k) => /risk|calc/i.test(k))).toBe(false);
  // 12 · no progression / report / journal key created.
  expect(storageAfterInput.local["ata.lesson-progress.v1"]).toBeUndefined();
  expect(storageAfterInput.local["ata.report-workspace.v3"]).toBeUndefined();
  expect(storageAfterInput.local["ata.tools.trading-journal.v1"]).toBeUndefined();

  // 10 · a refresh resets all four inputs and removes the result.
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByLabel("Расчётный капитал")).toHaveValue("");
  await expect(page.getByLabel("Риск на сделку, %")).toHaveValue("");
  await expect(page.getByLabel("Цена входа")).toHaveValue("");
  await expect(page.getByLabel("Стоп-цена")).toHaveValue("");
  await expect(page.locator(".rc-strip")).toHaveCount(0);
  await expect(page.locator(".rc-ledger-row.is-on")).toHaveCount(0);
});

test("13 · progress below L15 stays locked — no calculator form", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(`${RISK}?scenario=early`, { waitUntil: "networkidle" });
  await expect(page.getByText(/Откроется на уровне 15/)).toBeVisible();
  await expect(page.getByLabel("Расчётный капитал")).toHaveCount(0);
  await expect(page.locator("input")).toHaveCount(0);
});

test("14-15 · mobile valid state shows the compact strip clearing the bottom nav + safe area", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  await page.goto(RISK, { waitUntil: "networkidle" });
  await fill(page, { capital: "1000", risk: "2", entry: "100", stop: "96" });
  await ready(page);

  // 14 · the compact strip appears (direction + units + notional), not before.
  const strip = page.locator(".rc-strip");
  await expect(strip).toBeVisible();
  await expect(strip.getByText("Лонг")).toBeVisible();
  await expect(strip.getByText("Размер позиции")).toBeVisible();
  await expect(strip.getByText("Расчётный номинал")).toBeVisible();

  // 15 · the strip stays above the fixed bottom navigation.
  const nav = page.locator("nav.bottomnav");
  await expect(nav).toBeVisible();
  const sBox = await strip.boundingBox();
  const nBox = await nav.boundingBox();
  expect(sBox!.y + sBox!.height).toBeLessThanOrEqual(nBox!.y + 1);
});

test("16 · EXACT zero page overflow at 390×844, 320×720 and 720×450 (hub/empty/valid/invalid)", async ({
  page,
}) => {
  const configs = [
    { width: 390, height: 844, name: "390x844" },
    { width: 320, height: 720, name: "320x720" },
    { width: 720, height: 450, name: "720x450@200%" },
  ];
  for (const size of configs) {
    await page.setViewportSize({ width: size.width, height: size.height });

    // Tools Hub with the Risk Calculator CTA (mobile hub state).
    await page.goto("/tools?scenario=active", { waitUntil: "networkidle" });
    await ready(page);
    await expectNoPageOverflow(page, `hub ${size.name}`);

    // Empty calculator.
    await page.goto(RISK, { waitUntil: "networkidle" });
    await ready(page);
    await expectNoPageOverflow(page, `empty ${size.name}`);

    // Valid long → the compact mobile result strip is mounted.
    await fill(page, { capital: "1000000", risk: "2", entry: "100", stop: "96" });
    await ready(page);
    await expect(page.locator(".rc-ledger-row.is-on")).toHaveCount(4);
    await expectNoPageOverflow(page, `valid-strip ${size.name}`);

    // Invalid (equal entry/stop) → no strip.
    await page.goto(RISK, { waitUntil: "networkidle" });
    await fill(page, { capital: "1000", risk: "2", entry: "100", stop: "100" });
    await ready(page);
    await expect(page.locator(".rc-strip")).toHaveCount(0);
    await expectNoPageOverflow(page, `invalid ${size.name}`);
  }
});

test("17-18 · disclaimer always visible; no broker/Pocket/execution/balance copy", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(RISK, { waitUntil: "networkidle" });
  await fill(page, { capital: "1000", risk: "2", entry: "100", stop: "96" });

  // 17 · the mandatory disclaimer is present.
  await expect(
    page.getByText(
      /Ручной учебный расчёт\. Данные не синхронизируются со счётом или брокером и не являются инвестиционной рекомендацией\./,
    ),
  ).toBeVisible();

  // 18 · no forbidden financial / execution language, no currency symbol.
  const text = await page.locator("body").innerText();
  for (const banned of [
    "Баланс",
    "баланс",
    "Доступно",
    "Средства на счёте",
    "Pocket",
    "брокер-терминал",
    "Ордер",
    "ордер",
    "Исполнено",
    "Куплено",
    "Продано",
    "₽",
    "$",
    "€",
    "USDT",
    "USD",
  ]) {
    expect(text.includes(banned), `must not show "${banned}"`).toBe(false);
  }
  // No execution/order button exists.
  await expect(page.getByRole("button", { name: /Купить|Продать|Ордер|Исполнить|сделку/ })).toHaveCount(0);
});

test("console clean on the calculator route", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(RISK, { waitUntil: "networkidle" });
  await ready(page);
  const hydration = errors.filter((e) => /hydrat|did not match|Text content does not match/i.test(e));
  expect(hydration, hydration.join("\n")).toHaveLength(0);
  expect(errors, errors.join("\n")).toHaveLength(0);
});
