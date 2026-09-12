import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { FIXTURES, leadPath, LEADS_PATH, signInAdmin, signInAnalyst } from "./support/leads-e2e";

/**
 * AFD-5C2 — screenshots for the visual review.
 *
 * THE REVEAL RESPONSE IS NEVER CAPTURED. Every shot below is taken as an
 * analyst, or as an administrator who has opened the confirmation and NOT
 * submitted it. `revealLeadPii` is not reachable from any code path this file
 * exercises, so no shot can contain a learner's address — and the assertion at
 * the end of each capture proves it rather than trusting it.
 */

const SHOT_DIR = process.env.LEADS_E2E_SHOT_DIR ?? "";

test.skip(SHOT_DIR === "", "LEADS_E2E_SHOT_DIR is required for the screenshot pass");

function shotPath(name: string): string {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  return path.join(SHOT_DIR, `${name}.png`);
}

/** Capture, then PROVE the frame carried no learner identity. */
async function capture(page: import("@playwright/test").Page, name: string) {
  const text = await page.evaluate(() => document.body.innerText);
  for (const lead of Object.values(FIXTURES.leads)) {
    expect(text, `${name} would have captured ${lead.email}`).not.toContain(lead.email);
    expect(text, `${name} would have captured ${lead.name}`).not.toContain(lead.name);
  }
  await page.screenshot({ path: shotPath(name), fullPage: true });
}

test.describe("screenshots — analyst", () => {
  test.beforeEach(async ({ context, request }) => {
    expect(await signInAnalyst(context, request)).toBe(200);
  });

  test("desktop and mobile lead list", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(LEADS_PATH);
    // Wait for the ROWS, not just the heading: the heading paints before the
    // first response, and a shot taken then would review a loading state.
    await expect(page.getByRole("link", { name: FIXTURES.leads.A.maskedEmail }).first()).toBeVisible();
    await capture(page, "01-lead-list-desktop");

    await page.setViewportSize({ width: 390, height: 900 });
    await page.reload();
    await expect(page.getByRole("link", { name: FIXTURES.leads.A.maskedEmail }).first()).toBeVisible();
    await capture(page, "02-lead-list-mobile");
  });

  test("redacted lead detail and the attributed timeline", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(leadPath(FIXTURES.leads.A.leadId));
    await expect(
      page.getByRole("heading", { name: FIXTURES.leads.A.maskedEmail, level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("list", { name: "Фактическая хронология" })).toBeVisible();
    await capture(page, "03-lead-detail-attributed");
  });

  test("direct, pending and conflict shapes", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });

    await page.goto(leadPath(FIXTURES.leads.D.leadId));
    await expect(page.getByText(/Аффилейт не назначается/)).toBeVisible();
    await capture(page, "04-lead-detail-direct");

    await page.goto(leadPath(FIXTURES.leads.P.leadId));
    await expect(page.getByText("Ожидает подтверждения Pocket-пользователя").first()).toBeVisible();
    await capture(page, "05-lead-detail-pending");

    await page.goto(leadPath(FIXTURES.leads.C.leadId));
    await expect(page.getByText("Обнаружен конфликт FD")).toBeVisible();
    await capture(page, "06-lead-detail-conflict");

    await page.goto(leadPath(FIXTURES.leads.G.leadId));
    await expect(page.getByRole("heading", { name: "Замечания к целостности данных" })).toBeVisible();
    await capture(page, "07-lead-detail-integrity");
  });

  test("filtered empty state", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(
      `${LEADS_PATH}?registrationPreset=custom&registrationStartDate=2020-01-01&registrationEndDate=2020-02-01`,
    );
    await expect(page.getByText("По выбранным фильтрам ничего не найдено")).toBeVisible();
    await capture(page, "08-lead-list-empty");
  });

  test("access denied for the analyst reveal", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(leadPath(FIXTURES.leads.E.leadId));
    await expect(page.getByText(/Доступ к аналитике аффилейтов его не даёт/)).toBeVisible();
    await capture(page, "09-lead-detail-no-reveal");
  });
});

test.describe("screenshots — crm_admin", () => {
  test("the reveal confirmation, BEFORE submission", async ({ context, request, page }) => {
    expect(await signInAdmin(context, request)).toBe(200);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(leadPath(FIXTURES.leads.A.leadId));

    await page.getByRole("button", { name: "Показать данные пользователя" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    // The capture helper asserts no identity is present — which is the whole
    // point: the dialog is open and NOTHING has been revealed.
    await capture(page, "10-reveal-confirmation");
  });
});
