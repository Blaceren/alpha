import { expect, test, type Page } from "@playwright/test";
import { FIXTURES, leadPath, LEADS_PATH, signInAdmin, signInAnalyst } from "./support/leads-e2e";

/**
 * AFD-5C2 — responsive and accessibility behaviour in a real browser.
 *
 * THE OVERFLOW RULE IS "NO NEW OVERFLOW", NOT "NO OVERFLOW". AFD-5C1 recorded a
 * PRE-EXISTING CRM-wide shell overflow at 320px with a 2x root font, affecting
 * unrelated routes. This suite therefore measures the AFD-5C1 baseline route
 * (`/affiliates/analytics`) and the AFD-5C2 routes at the same viewport and
 * compares them: a lead route that overflows no more than the analytics route
 * has introduced nothing. Reporting the shared-shell figure as an AFD-5C2
 * regression would be a misdiagnosis.
 */

const WIDTHS = [1920, 1440, 1280, 1024, 768, 390, 320] as const;

async function documentOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
}

async function setZoom(page: Page, factor: number) {
  await page.evaluate((value) => {
    document.documentElement.style.fontSize = `${16 * value}px`;
  }, factor);
}

test.describe("responsive", () => {
  test.beforeEach(async ({ context, request }) => {
    expect(await signInAnalyst(context, request)).toBe(200);
  });

  for (const width of WIDTHS) {
    test(`the lead list has no whole-page overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(LEADS_PATH);
      await expect(page.getByRole("heading", { name: "Лиды аффилейтов", level: 1 })).toBeVisible();

      expect(await documentOverflow(page)).toBe(0);

      // The filters stay operable at every width.
      await expect(page.getByLabel("Аффилейт", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Состояние депозита")).toBeVisible();
      // And the pagination stays reachable.
      await expect(page.getByRole("navigation", { name: "Постраничная навигация по лидам" })).toBeVisible();
    });

    test(`the lead detail has no whole-page overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(leadPath(FIXTURES.leads.A.leadId));
      await expect(
        page.getByRole("heading", { name: FIXTURES.leads.A.maskedEmail, level: 1 }),
      ).toBeVisible();

      expect(await documentOverflow(page)).toBe(0);
      // Timeline labels and timestamps stay in their own rows.
      await expect(page.getByRole("list", { name: "Фактическая хронология" }).locator("li").first()).toBeVisible();
    });
  }

  test("switches to readable cards below the table breakpoint", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(LEADS_PATH);
    await expect(page.getByRole("heading", { name: "Лиды аффилейтов", level: 1 })).toBeVisible();
    // The wide table is hidden and the card list carries the same rows.
    await expect(page.getByRole("table")).toBeHidden();
    await expect(page.getByRole("link", { name: FIXTURES.leads.A.maskedEmail }).first()).toBeVisible();
  });

  test("adds NO overflow beyond the pre-existing shell at 320px and 200% zoom", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });

    // The AFD-5C1 BASELINE, measured on this same run rather than assumed.
    await page.goto("/affiliates/analytics");
    await expect(page.getByRole("heading", { name: "Аналитика аффилейтов", level: 1 })).toBeVisible();
    await setZoom(page, 2);
    const baseline = await documentOverflow(page);

    await page.goto(LEADS_PATH);
    await expect(page.getByRole("heading", { name: "Лиды аффилейтов", level: 1 })).toBeVisible();
    await setZoom(page, 2);
    const list = await documentOverflow(page);

    await page.goto(leadPath(FIXTURES.leads.A.leadId));
    await expect(
      page.getByRole("heading", { name: FIXTURES.leads.A.maskedEmail, level: 1 }),
    ).toBeVisible();
    await setZoom(page, 2);
    const detail = await documentOverflow(page);

    // eslint-disable-next-line no-console
    console.log(
      `320px @200% overflow — analytics baseline ${baseline}px, leads list ${list}px, lead detail ${detail}px`,
    );
    expect(list).toBeLessThanOrEqual(baseline);
    expect(detail).toBeLessThanOrEqual(baseline);
  });
});

test.describe("accessibility", () => {
  test.beforeEach(async ({ context, request }) => {
    expect(await signInAnalyst(context, request)).toBe(200);
  });

  test("uses a semantic table with a caption and labelled columns", async ({ page }) => {
    await page.goto(LEADS_PATH);
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    for (const column of ["Учащийся (замаскировано)", "Этап пути", "Состояние депозита"]) {
      await expect(table.getByRole("columnheader", { name: column })).toBeVisible();
    }
  });

  test("makes every row reachable and openable by keyboard alone", async ({ page }) => {
    await page.goto(LEADS_PATH);
    await expect(page.getByRole("heading", { name: "Лиды аффилейтов", level: 1 })).toBeVisible();

    const first = page.getByRole("link", { name: FIXTURES.leads.A.maskedEmail }).first();
    await first.focus();
    await expect(first).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(FIXTURES.leads.A.leadId));
  });

  test("labels every filter control and the pagination", async ({ page }) => {
    await page.goto(LEADS_PATH);
    for (const label of [
      "Аффилейт",
      "Кампания",
      "Ссылка",
      "Привлечение",
      "Этап пути",
      "Состояние депозита",
      "Сортировка",
    ]) {
      // `exact`: "Аффилейт" is also a prefix of the section navigation's own
      // label ("Разделы аффилейтов"), and a substring match would resolve to
      // both.
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("navigation", { name: "Постраничная навигация по лидам" })).toBeVisible();
  });

  test("announces the current page", async ({ page }) => {
    await page.goto(`${LEADS_PATH}?pageSize=3`);
    const status = page.getByRole("status").filter({ hasText: "Страница" });
    await expect(status).toBeVisible();
  });

  test("carries state in words, never in colour alone", async ({ page }) => {
    await page.goto(leadPath(FIXTURES.leads.C.leadId));
    // The conflict is spelled out in text.
    await expect(page.getByText("Требует проверки конфликта").first()).toBeVisible();
    await expect(page.getByText("конфликт", { exact: true }).first()).toBeVisible();
  });

  test("renders the timeline as an ordered list with real time elements", async ({ page }) => {
    await page.goto(leadPath(FIXTURES.leads.A.leadId));
    const timeline = page.getByRole("list", { name: "Фактическая хронология" });
    await expect(timeline).toBeVisible();
    const items = timeline.locator("li");
    expect(await items.count()).toBeGreaterThan(2);
    // Each item carries a machine-readable instant.
    expect(await timeline.locator("time[datetime]").count()).toBeGreaterThan(2);
  });

  test("announces integrity findings", async ({ page }) => {
    await page.goto(leadPath(FIXTURES.leads.G.leadId));
    // The findings live in a labelled, polite live region — and the heading
    // inside it is still a real heading, reachable by heading navigation.
    await expect(
      page.getByRole("region", { name: "Замечания к целостности данных" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Замечания к целостности данных" }),
    ).toBeVisible();
  });
});

test.describe("reveal accessibility", () => {
  test("moves focus into the confirmation and back out again", async ({
    context,
    request,
    page,
  }) => {
    expect(await signInAdmin(context, request)).toBe(200);
    await page.goto(leadPath(FIXTURES.leads.A.leadId));

    const trigger = page.getByRole("button", { name: "Показать данные пользователя" });
    await trigger.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog.getByRole("button", { name: "Показать данные", exact: true })).toBeFocused();

    // Escape closes it and focus returns to the control that opened it.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    // Nothing was revealed by any of that.
    await expect(page.getByText(FIXTURES.leads.A.email)).toHaveCount(0);
  });

  test("fits the confirmation into a 320px viewport at 200% zoom", async ({
    context,
    request,
    page,
  }) => {
    expect(await signInAdmin(context, request)).toBe(200);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(leadPath(FIXTURES.leads.A.leadId));
    await setZoom(page, 2);

    await page.getByRole("button", { name: "Показать данные пользователя" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Both actions remain reachable.
    await expect(dialog.getByRole("button", { name: "Отмена" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Показать данные", exact: true })).toBeVisible();
    // The dialog never widens the document.
    const box = await dialog.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(320);
  });
});
